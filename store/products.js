const PRODUCTS = [
  {
    id: "performance-audit",
    code: "PA",
    index: "01",
    name: "iOS Performance Audit Checklist",
    type: "Checklist",
    price: 1,
    gumroadPrice: 1,
    buyUrl: "https://devinspire734.gumroad.com/l/perf-audit-checklist",
    format: "PDF + Markdown",
    files: "2 files · PDF 18 pages (A4) + editable Markdown",
    version: "1.0 · First edition",
    updated: "Oct 2026",
    support: "Xcode with Instruments; no fixed iOS version",
    tagline: "Find the launch, memory, scrolling, and package-size problems users feel first.",
    problem:
      "Late-stage launch, memory, scrolling, and app-size regressions that happy-path testing misses.",
    description:
      "A repeatable audit for the performance issues that escape happy-path testing. Each of the 60 checks names what to measure, how to measure it, and what a healthy result looks like, so findings turn into fixes instead of a folder of screenshots.",
    highlights: [
      "Cold launch, memory, scrolling, and app size in one pass",
      "Metric targets and evidence fields for every check"
    ],
    includes: [
      "60 checks spanning cold launch, first-frame rendering, memory growth, scrolling, and app size",
      "A measurement note for every check: what to capture, which tool to use, and the target to beat",
      "An audit record for app version, build, devices, pass/fail counts, and the overall ship decision",
      "A shortlist of the 8 checks most likely to expose user-visible regressions",
      "A severity scale (P0/P1/P2) and a release pass rule for team reviews",
      "A revision history so you can confirm which edition you are auditing against"
    ],
    fit: "iOS engineers, QA partners, and tech leads who need a shared definition of fast.",
    license:
      "Personal use. Use the checklist in your own apps and in client projects you deliver; do not resell, sublicense, or redistribute the files. See LICENSE.txt in the download for the full terms."
  },
  {
    id: "spm-starter-kit",
    code: "SPM",
    index: "02",
    name: "SPM Modularization Starter Kit",
    type: "Template + guide",
    price: 1,
    gumroadPrice: 1,
    buyUrl: "https://devinspire734.gumroad.com/l/spm-modularization-starter-kit",
    format: "Swift package + Markdown guide",
    files: "1 ZIP (13 files) · four Swift targets, README, layering guide, CI script",
    version: "1.0",
    updated: "Oct 2026",
    support: "Xcode 15+ / Swift 5.9+ · iOS 16+ or macOS 13+",
    tagline: "Turn one app target into a modular Swift package without slowing the team down.",
    problem:
      "An app target that has become the default home for every new file.",
    description:
      "A buildable four-layer Swift package plus the six-step migration playbook behind it. See how App, Feature, Core, and DesignSystem connect, then move your code one boundary at a time with dependency rules that keep the graph clean.",
    highlights: [
      "App, Feature, Core, and DesignSystem targets wired up",
      "Six-step migration playbook for an existing monolith"
    ],
    includes: [
      "A buildable four-target Swift package: App, Feature, Core, and DesignSystem",
      "A sample catalog feature plus Core value types and DesignSystem styles that show each boundary",
      "Dependency rules that prevent feature-to-feature imports",
      "A six-step migration playbook for moving an existing app target one boundary at a time",
      "Package.swift target setup, platform requirements, and release-surface notes for targets, schemes, extensions, and test targets",
      "A cycle checklist and a CI gate (check-layering.sh) that fails a pull request with a forbidden dependency"
    ],
    fit: "iOS teams moving an existing app target into modules without slowing delivery.",
    license:
      "Personal use. Use and modify the sample in apps you own or deliver to clients; do not resell, sublicense, or redistribute the package or the playbook. See LICENSE.txt in the download for the full terms."
  },
  {
    id: "release-checklist",
    code: "RC",
    index: "03",
    name: "App Store Release Checklist",
    type: "Checklist",
    price: 1,
    gumroadPrice: 1,
    buyUrl: "https://devinspire734.gumroad.com/l/app-store-release-checklist",
    format: "PDF + Markdown",
    files: "2 files · PDF 12 pages (A4) + editable Markdown",
    version: "1.0 · First edition",
    updated: "Oct 2026",
    support: "Xcode for archive validation; no fixed iOS version",
    tagline: "A calm, 40-point pass through everything App Review checks before you hit Submit.",
    problem:
      "App Review rejections and missing pre-submit checks found after the build is already uploaded.",
    description:
      "A pre-flight checklist for release owners who would rather find the problem now. Cover build settings, privacy, metadata, screenshots, review notes, and the rejection patterns that send builds back.",
    highlights: [
      "40 checks from build settings to review notes",
      "A rejection-risk note on every check"
    ],
    includes: [
      "40 pre-submission checks, ordered by the moment they matter",
      "Build, signing, capability, and privacy checks with a concrete thing to verify for each",
      "Store listing, screenshot, and review-note checks",
      "A rejection-risk note on every check, plus a recovery sequence if a build is rejected",
      "A Release record for version, build, waived items, phased-release decision, and rollback owner",
      "A post-launch monitoring section covering phased-release halt criteria and rollback ownership"
    ],
    fit: "Release owners and engineers who want one calm pass before submission.",
    license:
      "Personal use. Use the checklist for your own releases and client releases you manage; do not resell, sublicense, or redistribute the files. See LICENSE.txt in the download for the full terms."
  },
  {
    id: "ios-design-starter",
    code: "DS",
    index: "04",
    name: "iOS Design Starter Kit",
    type: "Design kit",
    price: 1,
    gumroadPrice: 1,
    buyUrl: "https://devinspire734.gumroad.com/l/ios-design-starter",
    format: "Swift package + design assets",
    files: "1 ZIP · Swift package (3 libraries + tests), 160 PDF icons, 160 SVGs, 4 themes",
    version: "1.0",
    updated: "Oct 2026",
    support: "Xcode 15+ / Swift 5.9+ · iOS 15+ or macOS 12+",
    tagline: "Start a consistent SwiftUI surface with 160 icons, four checked palettes, and fixtures that decode.",
    problem:
      "Inconsistent icons, colours, and sample data every time a new SwiftUI surface starts.",
    description:
      "A small, buildable SwiftUI starter: 160 normalized vector icons with a Swift enum, four semantic palettes in light and dark, synthetic fixtures with Codable models, and three utilities you can lift into a real project. The fixtures and utilities are original; icons and palettes come from permissively licensed sources, and every upstream is recorded in ATTRIBUTION.md.",
    highlights: [
      "160 icons (PDF/SVG) with a Swift enum",
      "Four palettes, light and dark, with a WCAG report"
    ],
    includes: [
      "160 vector icons (80 line + 80 solid) as PDFs plus 160 normalized SVGs, with a Swift enum for type-safe lookup",
      "Four semantic themes — Slate, Paper, Latte, and Mist — with light and dark values for 15 colour roles",
      "120 colour values across four palettes (15 roles × light/dark), plus type, spacing, radius, motion, and elevation tokens",
      "A WCAG contrast report for the main text, accent, status, and focus-ring pairs in every palette",
      "Synthetic fixtures: 24 users, 21 products, 12 articles, and 6 conversations (30 messages), with JSON Schemas and Codable models",
      "Three original Swift utilities: PerformanceSignpost, ImageDownsampler, and StableListDiff",
      "Integration guide, icon map, and theme preview",
      "README, ATTRIBUTION.md, LICENSE.txt, and ThirdPartyLicenses bundled in the download"
    ],
    fit: "SwiftUI developers who want a coherent starting point for icons, colour, and sample data.",
    license:
      "Personal use. Use it in unlimited apps you own or deliver to clients; do not resell the kit itself. Includes MIT-licensed icons and color palettes — keep the notices in ATTRIBUTION.md. See LICENSE.txt in the download for the full terms."
  }
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = PRODUCTS;
}
