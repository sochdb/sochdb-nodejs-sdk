/**
 * Context Query Builder for LLM Context Assembly
 * 
 * Token-aware context assembly with priority-based truncation.
 */

export enum ContextOutputFormat {
  TOON = 'toon',
  JSON = 'json',
  MARKDOWN = 'markdown',
}

export enum TruncationStrategy {
  TAIL_DROP = 'tail_drop',       // Drop from end
  HEAD_DROP = 'head_drop',       // Drop from beginning
  PROPORTIONAL = 'proportional', // Proportional across sections
}

interface Section {
  name: string;
  priority: number;
  content: string;
  tokenCount: number;
}

export interface ContextResult {
  text: string;
  tokenCount: number;
  sections: Array<{ name: string; tokenCount: number; truncated: boolean }>;
}

/**
 * Context Query Builder for assembling LLM context
 */
export class ContextQueryBuilder {
  private sessionId?: string;
  private tokenBudget: number = 4096;
  private format: ContextOutputFormat = ContextOutputFormat.TOON;
  private truncation: TruncationStrategy = TruncationStrategy.TAIL_DROP;
  private sections: Section[] = [];
  private currentSection?: Section;

  /**
   * Set session ID for context
   */
  forSession(sessionId: string): this {
    this.sessionId = sessionId;
    return this;
  }

  /**
   * Set token budget
   */
  withBudget(tokens: number): this {
    this.tokenBudget = tokens;
    return this;
  }

  /**
   * Set output format
   */
  setFormat(format: ContextOutputFormat): this {
    this.format = format;
    return this;
  }

  /**
   * Set truncation strategy
   */
  setTruncation(strategy: TruncationStrategy): this {
    this.truncation = strategy;
    return this;
  }

  /**
   * Add literal text section
   */
  literal(name: string, priority: number, text: string): this {
    const tokenCount = this.estimateTokens(text);
    this.sections.push({
      name,
      priority,
      content: text,
      tokenCount,
    });
    return this;
  }

  /**
   * Start a new section
   */
  section(name: string, priority: number): this {
    this.currentSection = {
      name,
      priority,
      content: '',
      tokenCount: 0,
    };
    return this;
  }

  /**
   * Add content to current section
   */
  get(path: string): this {
    if (!this.currentSection) {
      throw new Error('No active section. Call section() first.');
    }
    this.currentSection.content += `GET ${path}\n`;
    return this;
  }

  /**
   * Add last N records query
   */
  last(n: number, table: string): this {
    if (!this.currentSection) {
      throw new Error('No active section. Call section() first.');
    }
    this.currentSection.content += `LAST ${n} FROM ${table}\n`;
    return this;
  }

  /**
   * Add where equals condition
   */
  whereEq(field: string, value: any): this {
    if (!this.currentSection) {
      throw new Error('No active section. Call section() first.');
    }
    this.currentSection.content += `WHERE ${field} = ${JSON.stringify(value)}\n`;
    return this;
  }

  /**
   * Add vector search
   */
  search(collection: string, embedding: string, k: number): this {
    if (!this.currentSection) {
      throw new Error('No active section. Call section() first.');
    }
    this.currentSection.content += `SEARCH ${collection} WITH ${embedding} LIMIT ${k}\n`;
    return this;
  }

  /**
   * Add SQL query
   */
  sql(query: string): this {
    if (!this.currentSection) {
      throw new Error('No active section. Call section() first.');
    }
    this.currentSection.content += `SQL: ${query}\n`;
    return this;
  }

  /**
   * Finish current section
   */
  done(): this {
    if (this.currentSection) {
      this.currentSection.tokenCount = this.estimateTokens(this.currentSection.content);
      this.sections.push(this.currentSection);
      this.currentSection = undefined;
    }
    return this;
  }

  /**
   * Execute and build context
   */
  execute(): ContextResult {
    // Finish any pending section
    if (this.currentSection) {
      this.done();
    }

    // Sort sections by priority (lower = higher priority)
    const sortedSections = [...this.sections].sort((a, b) => a.priority - b.priority);

    // Calculate total tokens
    let totalTokens = sortedSections.reduce((sum, s) => sum + s.tokenCount, 0);

    // Truncate if needed
    const truncatedSections: Array<{ name: string; tokenCount: number; truncated: boolean }> = [];
    const includedSections: Section[] = [];

    if (totalTokens <= this.tokenBudget) {
      // No truncation needed
      for (const section of sortedSections) {
        includedSections.push(section);
        truncatedSections.push({
          name: section.name,
          tokenCount: section.tokenCount,
          truncated: false,
        });
      }
    } else {
      // Apply truncation strategy
      let remainingBudget = this.tokenBudget;

      if (this.truncation === TruncationStrategy.TAIL_DROP) {
        // Include sections in priority order until budget exhausted
        for (const section of sortedSections) {
          if (section.tokenCount <= remainingBudget) {
            includedSections.push(section);
            remainingBudget -= section.tokenCount;
            truncatedSections.push({
              name: section.name,
              tokenCount: section.tokenCount,
              truncated: false,
            });
          } else {
            truncatedSections.push({
              name: section.name,
              tokenCount: 0,
              truncated: true,
            });
          }
        }
      } else if (this.truncation === TruncationStrategy.PROPORTIONAL) {
        // Proportionally reduce all sections
        const ratio = this.tokenBudget / totalTokens;
        for (const section of sortedSections) {
          const allocatedTokens = Math.floor(section.tokenCount * ratio);
          const truncatedContent = this.truncateText(section.content, allocatedTokens);
          includedSections.push({
            ...section,
            content: truncatedContent,
            tokenCount: allocatedTokens,
          });
          truncatedSections.push({
            name: section.name,
            tokenCount: allocatedTokens,
            truncated: allocatedTokens < section.tokenCount,
          });
        }
      }
    }

    // Build final context based on format
    let text = '';
    let actualTokens = 0;

    if (this.format === ContextOutputFormat.TOON) {
      text = this.buildToonFormat(includedSections);
    } else if (this.format === ContextOutputFormat.JSON) {
      text = this.buildJsonFormat(includedSections);
    } else {
      text = this.buildMarkdownFormat(includedSections);
    }

    actualTokens = this.estimateTokens(text);

    return {
      text,
      tokenCount: actualTokens,
      sections: truncatedSections,
    };
  }

  // Helper methods
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token for English
    return Math.ceil(text.length / 4);
  }

  private truncateText(text: string, maxTokens: number): string {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) {
      return text;
    }
    return text.substring(0, maxChars) + '...';
  }

  private buildToonFormat(sections: Section[]): string {
    const lines: string[] = [];
    
    for (const section of sections) {
      lines.push(`[${section.name}]`);
      lines.push(section.content);
      lines.push('');
    }
    
    return lines.join('\n');
  }

  private buildJsonFormat(sections: Section[]): string {
    const obj: Record<string, string> = {};
    
    for (const section of sections) {
      obj[section.name] = section.content;
    }
    
    return JSON.stringify(obj, null, 2);
  }

  private buildMarkdownFormat(sections: Section[]): string {
    const lines: string[] = [];
    
    for (const section of sections) {
      lines.push(`## ${section.name}`);
      lines.push('');
      lines.push(section.content);
      lines.push('');
    }
    
    return lines.join('\n');
  }
}

/**
 * Create a context query builder
 */
export function createContextBuilder(): ContextQueryBuilder {
  return new ContextQueryBuilder();
}
