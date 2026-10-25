import { describe, expect, it } from "vitest";
import { profileSectionFromHash, profileSectionForKey } from "@/features/profile/navigation";

describe("profile task navigation", () => {
  it("supports existing deep links and returns to Account for absent or unrelated fragments", () => {
    for (const section of ["account", "content", "statistics", "appearance"] as const)
      expect(profileSectionFromHash(`#${section}`)).toBe(section);
    for (const hash of ["", "#unknown", "#ACCOUNT", "#statistics/other"])
      expect(profileSectionFromHash(hash)).toBe("account");
  });

  it("wraps horizontal keyboard selection and supports first and last task shortcuts", () => {
    expect(profileSectionForKey("account", "ArrowLeft")).toBe("appearance");
    expect(profileSectionForKey("appearance", "ArrowRight")).toBe("account");
    expect(profileSectionForKey("content", "ArrowRight")).toBe("statistics");
    expect(profileSectionForKey("statistics", "ArrowLeft")).toBe("content");
    expect(profileSectionForKey("statistics", "Home")).toBe("account");
    expect(profileSectionForKey("content", "End")).toBe("appearance");
  });

  it("leaves ordinary Tab, activation and vertical keys to native button navigation", () => {
    for (const key of ["Tab", "Enter", " ", "ArrowUp", "ArrowDown", "Escape"])
      expect(profileSectionForKey("content", key)).toBeNull();
  });
});
