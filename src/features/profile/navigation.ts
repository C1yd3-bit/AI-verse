export const profileSections = ["account", "content", "statistics", "appearance"] as const;
export type ProfileSection = (typeof profileSections)[number];

export function profileSectionFromHash(hash: string): ProfileSection {
  return profileSections.find((section) => hash === `#${section}`) ?? "account";
}

export function profileSectionForKey(section: ProfileSection, key: string): ProfileSection | null {
  const index = profileSections.indexOf(section);
  if (key === "Home") return profileSections[0];
  if (key === "End") return profileSections[profileSections.length - 1];
  if (key === "ArrowRight") return profileSections[(index + 1) % profileSections.length];
  if (key === "ArrowLeft")
    return profileSections[(index + profileSections.length - 1) % profileSections.length];
  return null;
}
