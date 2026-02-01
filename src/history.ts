export default class HistoryService {
  /**
   * Save a file to the history.
   * If the file already exists, it will be updated; otherwise, it will be inserted.
   * @param filePath - The path of the file to save
   * @param data - The file content as Uint8Array
   */
  async save(filePath: string, data: Uint8Array): Promise<void> {
  }

  /**
   * Get the diff of a file compared to what is stored in history.
   * Returns the changes between the working state and the last checkpoint.
   * @param filePath - The path of the file to diff
   * @returns Array of human-readable diff results showing what changed
   */
  diff(filePath: string): string {
    return ""
  }
}
