export const remixPresets = [
  {
    id: "clean",
    name: "Clean",
    picture: { look: "none", brightness: 1, contrast: 1, saturate: 1, blur: 0, vignette: false, kenBurns: false },
  },
  {
    id: "golden",
    name: "Golden hour",
    picture: { look: "warm", brightness: 1.06, contrast: 1.04, saturate: 1.2, blur: 0, vignette: true, kenBurns: true },
  },
  {
    id: "moonlight",
    name: "Moonlight",
    picture: { look: "cool", brightness: 0.92, contrast: 1.12, saturate: 0.8, blur: 0, vignette: true, kenBurns: false },
  },
  {
    id: "silver",
    name: "Silver",
    picture: { look: "mono", brightness: 1.02, contrast: 1.18, saturate: 0.1, blur: 0, vignette: true, kenBurns: false },
  },
  {
    id: "poster",
    name: "Poster",
    picture: { look: "punch", brightness: 1.04, contrast: 1.28, saturate: 1.35, blur: 0, vignette: false, kenBurns: false },
  },
  {
    id: "memory",
    name: "Memory",
    picture: { look: "fade", brightness: 1.08, contrast: 0.88, saturate: 0.72, blur: 0, vignette: true, kenBurns: true, fadeIn: 0.5, fadeOut: 0.55 },
  },
  {
    id: "drift",
    name: "Drift",
    picture: { look: "none", brightness: 1, contrast: 1.05, saturate: 1.05, blur: 0, vignette: false, kenBurns: true },
  },
  {
    id: "noir",
    name: "Noir",
    picture: { look: "noir", brightness: 0.95, contrast: 1.35, saturate: 0.15, blur: 0, vignette: true, kenBurns: false },
  },
  {
    id: "caption",
    name: "Caption",
    title: { titleStyle: "lower", motion: "rise", y: 0.84, fontSize: 42, fadeIn: 0.3, fadeOut: 0.35 },
  },
  {
    id: "headline",
    name: "Headline",
    title: { titleStyle: "outline", motion: "rise", y: 0.5, fontSize: 84, fadeIn: 0.25, fadeOut: 0.35 },
  },
];
