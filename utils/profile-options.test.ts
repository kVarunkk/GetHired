import { describe, expect, it } from "vitest";
import { filterConfigBuilder } from "@/helpers/filter-component/filterConfigBuilder";
import { commonJobTitles, commonSkills, mergeOptions } from "./profile-options";

const optionsOf = (name: string, found: { job_role: string }[] = [], skills: { skill: string }[] = []) =>
  filterConfigBuilder("profiles", [], [], found, [], skills)
    .find((config) => config.name === name)
    ?.options?.map((option) => option.value);

describe("mergeOptions", () => {
  it("puts the common names first and drops repeats, blanks and values with a pipe", () => {
    expect(mergeOptions(["React", "SQL"], [" react ", "Elm", "", "a|b", "elm"])).toEqual([
      "React",
      "SQL",
      "Elm",
    ]);
  });

  it.each([
    ["job titles", commonJobTitles],
    ["skills", commonSkills],
  ])("has no repeated %s", (_label, list) => {
    expect(mergeOptions(list, [])).toEqual(list);
  });
});

describe("talent search role and skill options", () => {
  it("offers the common ones even when no profile values load", () => {
    expect(optionsOf("jobRole")).toEqual(commonJobTitles);
    expect(optionsOf("skills")).toEqual(commonSkills);
  });

  it("adds the values found in profiles", () => {
    expect(optionsOf("jobRole", [{ job_role: "Beekeeper" }])).toContain("Beekeeper");
    expect(optionsOf("skills", [], [{ skill: "Beekeeping" }])).toContain("Beekeeping");
  });
});
