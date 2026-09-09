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
      // Brand marks (Covers/idara logos) are tiny static PNGs in /public,
      // rendered at exact px sizes for pixel-fidelity with the design handoff.
      // next/image optimization offers no benefit at <24px and can shift
      // sub-20px inline layout, so plain <img> is intentional here.
      "@next/next/no-img-element": "off",
    },
  },
  {
    /* ============================================================
       Two type-aware rules, for one bug this repo has shipped nine
       times.

           if (!workerOf(req)) return 401

       workerOf() is async. A Promise is always truthy, so that
       guard never fires and the route answers as though nobody
       needs to be signed in. c454bc6 fixed eight of these at once
       and a ninth reached main separately, and NOTHING SAW ANY OF
       THEM: tsc is silent, the build is silent, eslint was silent.
       The one that got caught was caught only because its author
       went on to destructure the value, which made it a type error
       by accident.

       So the shape is not carelessness — it is the natural way to
       write a guard, and it was undetectable. These two rules are
       the detector.

       Type-aware, which is why they were not already on. next/
       typescript brings in the recommended set rather than the
       type-checked one, so @typescript-eslint appears configured
       and does not check this. projectService is what turns the
       type information on; it costs about ten seconds a run.

       Deliberately two rules rather than recommended-type-checked.
       That preset reports 875 problems here, 537 of them
       require-await and 158 no-unsafe-member-access off
       `await res.json()` — a different project, and one that
       would bury this. Measured before choosing.
       ============================================================ */
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    rules: {
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
];

export default eslintConfig;
