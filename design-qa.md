# PagePort 0.5.0 Visual QA

## Sources And Evidence

- Brand source: `resources/icon.png`, the user's selected double-page bridge.
- Website style source: `artifacts/feishu-download-reference.png`.
- Website implementation: `artifacts/site-redesign-desktop.png`.
- Comparison: both website images viewed together in one comparison call.
- Both desktop captures: 1265 x 712 image pixels, 1280 x 720 CSS viewport; the browser screenshot service applies the same output scaling. No additional crop or density conversion.
- Responsive evidence: `artifacts/site-redesign-{1440,1920,375,320}.png`.
- Native app evidence: `artifacts/mac-development-0.5.0/desktop-spacing-{normal,narrow}.png` and `desktop-settings.png`.
- Native captures use the actual Electron window, including the same OS frame inset as the existing smoke suite.

## Findings And Iteration

1. P2: initial download layout hid the next section at a short desktop height. Reduced system-tile height and section gaps; secondary safety copy is hidden in short viewports because the same information remains below. Revised desktop capture shows the workflow heading.
2. P2: at 320px the final character of the title wrapped alone. Kept the title suffix together; revised mobile capture has two balanced lines.
3. P2: narrow document metadata wrapped character by character. Moved document actions onto their own grid row and kept metadata on one line. Rebuilt native smoke suite passes with updated screenshots.

## Required Surfaces

- Typography: system Chinese/Latin sans-serif, zero tracking, restrained workspace type, prominent download heading. No substituted web-font dependency.
- Layout: centered heading and system tiles follow the reference hierarchy. Navigation, CTA and the beginning of the next section are visible. No horizontal overflow at 1280/1440/1920/375/320 CSS px.
- Tokens: white paper, blue editing/selection, teal publishing/success. No copied Feishu logo, promotion banner or unrelated platform options.
- Assets: approved raster artwork used unchanged, locally served at navigation and favicon sizes. Generated transparent-background attempts were rejected for ragged edges.
- Copy: PagePort-specific compatibility and security limits remain. Mock workflow is explicitly identified as fictional.
- Interactions: both OS selections update the same download URL, filename and SHA-256. Selection alone does not download. Native editing, TOC, common formatting, focus/narrow layouts, settings and verified update download pass.
- Browser console: no errors observed in the local download-page check.
- Follow-up requirements: blank startup verified before explicitly opening the new fictional format sample; editor modules and synthetic online rich-text paste checked in native smoke. Font size, cell shading and missing-image publish blockers have focused automated coverage.
- DingTalk guidance evidence: `artifacts/site-dingtalk-guide.png` and `artifacts/site-dingtalk-320.png`; no horizontal overflow or missing images. No actual company document was used for screenshots.

## Accepted Differences

- This is a style-led redesign, not a pixel-for-pixel Feishu clone. Two supported operating systems replace five tiles; one explicit download action replaces direct tile downloads.
- Flat pale background replaces the reference's decorative gradient. PagePort's existing security and publishing behavior is unchanged.
- Signing/notarization is outside this visual update.

final result: passed
