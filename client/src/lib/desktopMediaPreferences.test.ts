import { beforeEach, describe, expect, it } from "vitest";
import { readDesktopMediaPreferences, saveDesktopMediaPreferences } from "./desktopMediaPreferences";

describe("preferências de mídia no computador", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } as Storage;

  beforeEach(() => values.clear());

  it("restaura escolhas de microfone, câmera e saída de áudio", () => {
    saveDesktopMediaPreferences({ audioInputId: "mic-1", videoInputId: "cam-1", audioOutputId: "speaker-1" }, storage);
    expect(readDesktopMediaPreferences(storage)).toEqual({ audioInputId: "mic-1", videoInputId: "cam-1", audioOutputId: "speaker-1" });
  });

  it("usa escolhas vazias quando não existe configuração anterior", () => {
    expect(readDesktopMediaPreferences(storage)).toEqual({ audioInputId: "", videoInputId: "", audioOutputId: "" });
  });
});
