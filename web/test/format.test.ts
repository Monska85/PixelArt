import { describe, expect, it } from "vitest";
import { formatSize } from "../src/ui/format";

describe("formatSize", () => {
  it("writes bytes below 1,024 as they are", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(845)).toBe("845 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  it("writes kilobytes and megabytes with one decimal, base 1,024", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(2970)).toBe("2.9 KB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(1.4 * 1024 * 1024)).toBe("1.4 MB");
  });

  it("does not write 1024.0 KB", () => {
    expect(formatSize(1024 * 1024 - 1)).toBe("1.0 MB");
  });
});
