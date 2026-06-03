import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Brand marks (FairShift/idara logos) are tiny static PNGs in /public,
      // rendered at exact px sizes for pixel-fidelity with the design handoff.
      // next/image optimization offers no benefit at <24px and can shift
      // sub-20px inline layout, so plain <img> is intentional here.
      "@next/next/no-img-element": "off",
    },
  },
];

export default eslintConfig;
