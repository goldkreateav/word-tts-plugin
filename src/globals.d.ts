declare const OfficeRuntime: {
  storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
  };
};

declare const __DEBUG__: boolean;
declare const __DEFAULT_TTS_API_BASE_URL__: string;
