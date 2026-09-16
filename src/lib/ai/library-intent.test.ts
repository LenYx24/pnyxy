import { describe, it, expect } from "vitest";
import { detectLibraryOrganizeIntent } from "./library-tools";

// The detector lets the "organize my library" skill fire from a plain chat
// (no need to pick the "Organize library" composer mode). A positive routes
// the turn through the tool-use path; a false positive is not destructive
// because every write asks for the user's approval first. We still want it to
// fire on real organize/create-folder/move asks (HU + EN) and stay off for
// ordinary chat that merely mentions a folder or library.
describe("detectLibraryOrganizeIntent", () => {
  it("fires on create-folder-and-move requests (HU)", () => {
    expect(
      detectLibraryOrganizeIntent(
        "Hozz létre egy Matek mappát és tedd oda a füzeteket",
      ),
    ).toBe(true);
    expect(detectLibraryOrganizeIntent("rendezd a könyvtáram")).toBe(true);
    expect(
      detectLibraryOrganizeIntent("tedd ezt a beszélgetést a Fizika mappába"),
    ).toBe(true);
    expect(
      detectLibraryOrganizeIntent("csoportosítsd a mappáim témák szerint"),
    ).toBe(true);
  });

  it("fires on create-folder-and-move requests (EN)", () => {
    expect(
      detectLibraryOrganizeIntent("create a folder for my biology notes"),
    ).toBe(true);
    expect(detectLibraryOrganizeIntent("organize my library")).toBe(true);
    expect(
      detectLibraryOrganizeIntent("sort my folders by subject"),
    ).toBe(true);
  });

  it("stays off when only the noun is present (no organize verb)", () => {
    expect(detectLibraryOrganizeIntent("mi az a mappa?")).toBe(false);
    expect(detectLibraryOrganizeIntent("hány mappám van?")).toBe(false);
    expect(detectLibraryOrganizeIntent("what's in my library?")).toBe(false);
  });

  it("stays off when the verb targets something outside the library", () => {
    expect(detectLibraryOrganizeIntent("készíts egy kvízt a fotoszintézisről")).toBe(
      false,
    );
    expect(detectLibraryOrganizeIntent("create a roadmap for learning Rust")).toBe(
      false,
    );
    expect(detectLibraryOrganizeIntent("write me a poem about the sea")).toBe(false);
  });

  it("handles empty / whitespace input", () => {
    expect(detectLibraryOrganizeIntent("")).toBe(false);
    expect(detectLibraryOrganizeIntent("   ")).toBe(false);
  });
});
