declare module "pdfmake" {
  const pdfmake: {
    createPdf(
      definition: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): {
      getBuffer(): Promise<Buffer>;
    };
    setFonts(fonts: Record<string, unknown>): void;
    setLocalAccessPolicy(callback: (path: string) => boolean): void;
    setUrlAccessPolicy(callback: (url: string) => boolean): void;
    virtualfs: {
      writeFileSync(
        filename: string,
        content: Buffer | string,
        options?: string | { encoding?: string },
      ): void;
    };
  };
  export default pdfmake;
}

declare module "pdfmake/fonts/Roboto" {
  const fonts: Record<string, unknown>;
  export default fonts;
}

declare module "pdfmake/build/fonts/Roboto" {
  const fontContainer: {
    vfs: Record<
      string,
      {
        data: string;
        encoding?: BufferEncoding;
      }
    >;
    fonts: Record<string, unknown>;
  };
  export default fontContainer;
}

declare module "pdfmake/build/vfs_fonts" {
  const fonts: Record<string, string>;
  export default fonts;
}
