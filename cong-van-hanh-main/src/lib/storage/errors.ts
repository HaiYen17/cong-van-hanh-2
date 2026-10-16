export class StorageNotConfiguredError extends Error {
  constructor(provider: string) {
    super(
      `Kho file ${provider} chưa được cấu hình. Hệ thống chưa tải hoặc xoá file.`,
    );
    this.name = "StorageNotConfiguredError";
  }
}
