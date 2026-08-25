
import {
  BETA_ACCENT,
  BETA_ACCENT_DEEP,
  BETA_ACCENT_SOFT,
  useIsBetaBuild,
} from "../utils/betaBuild";
import { BetaTag } from "./wordmark";

/*
 * The mark, inlined.
 *
 * It is `public/logo.svg` written out as JSX rather than an <img>, because a
 * beta build recolours part of it and draws a wink — neither of which can be
 * done to a file the browser has already decoded.
 *
 * Keep this in step with public/logo.svg by hand. They are the same drawing and
 * nothing ties them together at build time; update one without the other and
 * the app shows a different owl from the one on every README and every favicon,
 * with nothing to say so.
 *
 * The 2026 mark inverted figure and ground. The old one was a dark bird on a
 * violet disc, so tinting the *background* was what made a beta build look like
 * one. Here the ground is dark and the bird carries the colour, so the tint
 * moved to the bird — tinting the ground now would only darken a dark square.
 */
function LogoIcon({ size = 48, beta = false }: { size?: number; beta?: boolean }) {
  const body = beta ? BETA_ACCENT : "#A495E3";
  // The bird is three tones — the face above the body, the wings below it —
  // and all three have to move together. Tinting the body alone gave a beta
  // build an amber owl with a violet face and violet wings.
  const face = beta ? BETA_ACCENT_SOFT : "#B5A8E6";
  const wing = beta ? BETA_ACCENT_DEEP : "#7C6EC3";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g clipPath="url(#logo-clip)">
        <rect width="1024" height="1024" fill="#2E2D5F" />
        <path
          d="M117.45 677.727C120.743 664.113 120.36 602.152 119.637 587.363C108.168 353.556 283.596 184.2 515.449 191.21C628.229 194.622 718.768 215.015 802.396 299.432C910.784 408.844 908.561 532.939 906.96 674.973C980.416 846.971 995.413 1003.44 928.604 1184.1C909.952 1234.53 867.051 1304.75 824.991 1339.24C790.453 1359.89 755.156 1380.9 714.224 1385.74C709.786 1397.93 708.22 1406.2 698.584 1414.62C671.044 1416.11 672.356 1412.41 650.517 1432.58C636.333 1434.54 635.588 1434.81 621.437 1424.16C619.727 1422.87 618.028 1421.55 616.348 1420.22C586.972 1422.33 583.755 1428.57 567.16 1401.62L461.79 1401.57C430.607 1447.05 435.866 1402.27 392.078 1431.99C375.144 1433.23 354.006 1420.75 337.187 1415.75C321.629 1411.12 319.352 1403.15 312.868 1388.28C259.874 1377.86 241.992 1355.86 203.048 1339.89C155.686 1305.18 114.107 1232 94.36 1178.04C30.9054 1004.63 43.665 843.414 117.45 677.727Z"
          fill={body}
        />
        <path
          d="M644.863 353C728.718 353 797.231 400.641 801.761 483.172H802C802 484.836 801.984 486.498 801.956 488.16C801.985 489.397 802 490.638 802 491.882C802 500.32 801.331 508.603 800.045 516.68C796.951 543.102 790.208 569.026 779.963 593.702C765.414 628.744 744.09 660.584 717.207 687.404C690.325 714.224 658.411 735.499 623.287 750.014C588.163 764.529 550.518 772 512.5 772C474.482 772 436.837 764.529 401.713 750.014C366.589 735.499 334.675 714.224 307.793 687.404C280.91 660.584 259.586 628.744 245.037 593.702C234.792 569.026 228.048 543.103 224.955 516.681C223.668 508.604 223 500.321 223 491.882C223 490.638 223.015 489.397 223.044 488.16C223.015 486.498 223 484.836 223 483.172H223.239C227.769 400.641 296.282 353 380.137 353C435.721 353 509.197 384.119 512.5 384.119C515.803 384.119 589.279 353 644.863 353Z"
          fill={face}
        />
        <path
          d="M637.617 445.204C665.591 435.093 696.445 449.712 706.342 477.765C716.239 505.817 701.39 536.563 673.265 546.251C645.44 555.834 615.095 541.175 605.303 513.42C595.511 485.664 609.94 455.207 637.617 445.204Z"
          fill="#2E2D5F"
        />
        {/*
          The owl winks on a beta build. Nobody who is not looking for it will
          notice; everyone who ships betas will.

          The eye is replaced rather than drawn over. It is painted in the
          ground's own colour, so a stroke laid on top of it would be one dark
          shape on another and read as nothing at all — which is what the
          previous mark could get away with, its eyes being the light part.
        */}
        {beta ? (
          <path
            d="M322 484 Q369.5 536 417 484"
            stroke="#2E2D5F"
            strokeWidth="22"
            strokeLinecap="round"
            fill="none"
          />
        ) : (
          <path
            d="M351.43 445.189C379.259 435.201 409.911 449.686 419.866 477.529C429.817 505.372 415.293 536.009 387.442 545.929C359.639 555.83 329.07 541.337 319.137 513.545C309.2 485.75 323.652 455.159 351.43 445.189Z"
            fill="#2E2D5F"
          />
        )}
        <path
          d="M512.359 573.191C508.812 573.17 516.378 573.212 512.359 573.191C572.603 573.544 536.569 640.612 516.085 676.829C514.504 679.626 510.416 679.514 508.945 676.658C490.115 640.101 452.322 573.191 512.359 573.191Z"
          fill="#2E2D5F"
        />
        <path
          d="M906.96 674.972C980.417 846.97 995.414 1003.44 928.605 1184.1C909.953 1234.53 867.051 1304.74 824.992 1339.24C737.388 1214.12 737.93 956.855 814.166 829.785C845.783 777.085 880.299 731.645 906.96 674.972Z"
          fill={wing}
        />
        <path
          d="M117.45 677.728C148.478 736.742 188.64 787.208 219.025 842.528C286.593 965.554 281.984 1131.04 239.787 1261.69C231.441 1286.49 220.568 1319.3 203.048 1339.89C155.686 1305.18 114.107 1232 94.36 1178.04C30.9054 1004.63 43.665 843.414 117.45 677.728Z"
          fill={wing}
        />
      </g>
      <defs>
        <clipPath id="logo-clip">
          {/* Round, and `public/logo.svg` is the same rect with the same rx
              on it.

              The square artboard lives in `public/logo-square.svg` and has one
              consumer, `scripts/generate-icons.mjs`, because a launcher
              applies its own mask and wants the full frame. Everywhere a
              person looks at the mark — the READMEs, both favicons, the tray,
              this component — it is round. */}
          <rect width="1024" height="1024" rx="512" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

export function Logo() {
  const isBeta = useIsBetaBuild();

  return (
    <div className="flex justify-center items-center gap-3">
      <h2 className="text-4xl">Gryt</h2>
      {isBeta && <BetaTag />}
      <LogoIcon beta={isBeta} />
    </div>
  );
}
