import type { Accessory } from "@gryt/owl";

import { AccessoryPaths } from "./wardrobe";

// The guide owl, drawn from Sivert's Default/Point/Hiding SVGs (1269x1269, 2026-11-06) and animated by parts.
const BODY = "M239.884 926.727C243.177 913.113 242.794 851.152 242.071 836.363C230.602 602.556 406.03 433.2 637.883 440.21C750.663 443.622 841.202 464.015 924.829 548.432C1033.22 657.844 1030.99 781.939 1029.39 923.973C1102.85 1095.97 1117.85 1252.44 1051.04 1433.1C1032.39 1483.53 989.484 1553.75 947.424 1588.24C912.887 1608.89 877.59 1629.9 836.658 1634.74C832.219 1646.93 830.654 1655.2 821.017 1663.62C793.478 1665.11 794.79 1661.41 772.95 1681.58C758.767 1683.54 758.022 1683.81 743.87 1673.16C742.161 1671.87 740.462 1670.55 738.781 1669.22C709.405 1671.33 706.188 1677.57 689.593 1650.62L584.224 1650.57C553.04 1696.05 558.299 1651.27 514.512 1680.99C497.577 1682.23 476.439 1669.75 459.62 1664.75C444.063 1660.12 441.786 1652.15 435.301 1637.28C382.307 1626.86 364.426 1604.86 325.482 1588.89C278.119 1554.18 236.54 1481 216.794 1427.04C153.339 1253.63 166.099 1092.41 239.884 926.727Z";
const SIDE_R = "M1029.39 923.973C1102.85 1095.97 1117.85 1252.44 1051.04 1433.1C1032.39 1483.53 989.485 1553.75 947.425 1588.24C859.821 1463.12 860.363 1205.86 936.599 1078.79C968.216 1026.09 1002.73 980.645 1029.39 923.973Z";
const SIDE_L = "M239.884 926.729C270.912 985.743 311.074 1036.21 341.458 1091.53C409.026 1214.55 404.418 1380.04 362.221 1510.7C353.875 1535.49 343.002 1568.3 325.482 1588.9C278.119 1554.18 236.54 1481.01 216.794 1427.04C153.339 1253.63 166.099 1092.41 239.884 926.729Z";
const FACE = "M767.297 602C851.152 602 919.665 649.641 924.194 732.172H924.434C924.434 733.836 924.418 735.498 924.389 737.16C924.418 738.397 924.434 739.638 924.434 740.882C924.434 749.32 923.765 757.603 922.478 765.68C919.385 792.102 912.642 818.026 902.397 842.702C887.848 877.744 866.523 909.584 839.641 936.404C812.758 963.224 780.844 984.499 745.72 999.014C710.597 1013.53 672.951 1021 634.934 1021C596.916 1021 559.27 1013.53 524.147 999.014C489.023 984.499 457.109 963.224 430.226 936.404C403.344 909.584 382.019 877.744 367.471 842.702C357.226 818.026 350.482 792.103 347.388 765.681C346.102 757.604 345.434 749.321 345.434 740.882C345.434 739.638 345.448 738.397 345.477 737.16C345.449 735.498 345.434 733.836 345.434 732.172H345.673C350.203 649.641 418.716 602 502.571 602C558.155 602 631.63 633.119 634.934 633.119C638.237 633.119 711.713 602 767.297 602Z";
const EYE_R = "M760.051 694.204C788.025 684.093 818.879 698.712 828.776 726.765C838.673 754.817 823.824 785.563 795.698 795.251C767.873 804.834 737.528 790.175 727.736 762.42C717.944 734.664 732.374 704.207 760.051 694.204Z";
const EYE_L = "M473.864 694.19C501.693 684.202 532.345 698.687 542.299 726.53C552.25 754.373 537.727 785.01 509.876 794.93C482.072 804.831 451.504 790.338 441.571 762.546C431.634 734.751 446.085 704.16 473.864 694.19Z";
const BEAK = "M634.792 822.192C631.245 822.171 638.811 822.212 634.792 822.192C695.037 822.544 659.003 889.612 638.519 925.83C636.937 928.626 632.85 928.515 631.379 925.658C612.549 889.101 574.755 822.191 634.792 822.192Z";
const RING = "M1237 634.5C1237 967.252 967.252 1237 634.5 1237C301.748 1237 32 967.252 32 634.5C32 301.748 301.748 32 634.5 32C967.252 32 1237 301.748 1237 634.5Z";
const PAW_L = "M224.1 1151.99C139.348 1116.1 166.663 955.814 225.979 945.417C285.295 935.02 319.127 971.358 347.688 1006.92C376.248 1042.48 394.538 1068.39 378.619 1101.54C362.701 1134.68 308.852 1187.87 224.1 1151.99Z";
const PAW_R = "M1038.77 1145.99C1123.52 1110.1 1096.21 949.814 1036.89 939.417C977.576 929.02 943.744 965.358 915.183 1000.92C886.623 1036.48 868.333 1062.39 884.252 1095.54C900.17 1128.68 954.019 1181.87 1038.77 1145.99Z";
const ARM = "M1026.84 864.43C1026.84 864.43 911.832 967.518 993.822 1061.01C1075.81 1154.5 1192.83 1185.88 1228.31 1195C1263.79 1204.13 1334.34 1218.55 1357.84 1212.51C1381.35 1206.46 1380.8 1183.51 1337.31 1119.01C1293.81 1054.51 1278.29 1037.2 1219.31 986.009C1160.33 934.819 1081.19 876.113 1026.84 864.43Z";

/** Top of the shoulder in Point.svg, where the arm turns from. The drawn arm reaches out at 46° below horizontal. */
const PIVOT = { x: 1010, y: 905 };
const ARM_ANGLE = 46;

export type OwlPose = {
  /** -1..1 each: where it looks. The face plate moves 20px, the eyes and beak 40px, for depth. */
  lookX: number; lookY: number;
  /** 0 sits, 1 is the raised pointing stance (61px up), -1 has ducked behind the ring (323px down). */
  rise: number;
  /** 0 is the paw on the rim, 1 the arm fully out. */
  arm: number;
  /** Where the arm points, in degrees from straight right, clockwise. */
  aim: number;
  /** Which wing points; picked by the caller so travel never swaps it. */
  side?: "left" | "right";
  /** -1..1: the body slid forward inside the ring while it travels. */
  shift?: number;
  /** 0..1: the paws on the rim, which come up after the owl does. */
  paws?: number;
  /** 0..1: how far the beak is open, for talking. */
  beak?: number;
  /** 0 open, 1 shut: a blink is a few frames of this. */
  blink?: number;
  /** Kept to a few and changed rarely: the usual open eyes, happy arcs, or a wink. */
  mood?: "open" | "happy" | "wink" | "focus" | "scared" | "squint";
};

const EYES = { left: { x: 492, y: 744 }, right: { x: 778, y: 745 } };
const arc = (c: { x: number; y: number }) => `M${c.x - 52} ${c.y + 18}Q${c.x} ${c.y - 46} ${c.x + 52} ${c.y + 18}`;

export function Owl({ size, pose, mirrored, inner, id = "owl", wear = [] }: { size: number; pose: OwlPose; mirrored?: boolean; inner?: string; id?: string; wear?: Accessory[] }) {
  const dy = pose.rise >= 0 ? -61 * pose.rise : -323 * pose.rise;
  // Well past the drawn 20/40px: at the size it plays at, less than this barely reads as looking.
  const fx = 44 * pose.lookX, fy = 44 * pose.lookY;
  const ex = 88 * pose.lookX, ey = 88 * pose.lookY;
  const paws = pose.paws ?? 1;
  // Points with whichever wing faces the target; that wing's resting shape on the body hides while it is out.
  const a = ((pose.aim + 540) % 360) - 180;
  const left = pose.side ? pose.side === "left" : Math.abs(a) > 100;
  const aim = left ? (a > 0 ? 180 - a : -180 - a) : a;
  const out = Math.min(1, pose.arm * 2);
  const pawsShown = paws > 0.01;
  return (
    <svg width={size} height={size} viewBox="0 0 1269 1269" style={{ overflow: "visible", transform: mirrored ? "scaleX(-1)" : undefined }}>
      <defs>
        <clipPath id={`${id}-clip`}><circle cx="634.5" cy="634.5" r="604" /></clipPath>
        <filter id={`${id}-paw`} x="-10%" y="-10%" width="120%" height="120%">
          <feOffset dy="-4" in="SourceAlpha" result="o" />
          <feGaussianBlur in="o" stdDeviation="1.5" result="b" />
          <feComposite in="b" in2="SourceAlpha" operator="out" result="s" />
          <feColorMatrix in="s" values="0 0 0 0 0.18 0 0 0 0 0.176 0 0 0 0 0.37 0 0 0 0.4 0" />
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Inside the ring only; full size, its edge showed around the outside of the ring. */}
      <circle cx="634.5" cy="634.5" r="604" fill="#2E2D5F" />
      <g clipPath={`url(#${id}-clip)`}>
        {inner ? (
          <image href={inner} x={140 + 70 * (pose.shift ?? 0)} y={300 + dy + 120} width="990" height="990" />
        ) : (
        <g transform={`translate(${70 * (pose.shift ?? 0)} ${dy})`}>
          <path d={BODY} fill="#A495E3" />
          <path d={SIDE_R} fill="#7C6EC3" opacity={left ? 1 : 1 - out} />
          <path d={SIDE_L} fill="#7C6EC3" opacity={left ? 1 - out : 1} />
          <path d={FACE} fill="#B5A8E6" transform={`translate(${fx} ${fy})`} />
          <g transform={`translate(${ex} ${ey})`} fill="#2E2D5F">
            {(["left", "right"] as const).map((side) => {
              const c = EYES[side];
              const shut = pose.mood === "happy" || (pose.mood === "wink" && side === "right");
              if (shut) return <path key={side} d={arc(c)} fill="none" stroke="#2E2D5F" strokeWidth="26" strokeLinecap="round" />;
              if (pose.mood === "focus") return <path key={side} d={`M${c.x - 50} ${c.y - 6}Q${c.x} ${c.y + 34} ${c.x + 50} ${c.y - 6}`} fill="none" stroke="#2E2D5F" strokeWidth="26" strokeLinecap="round" />;
              // Squinting: lids half down while it reads something small.
              const sy = (1 - 0.9 * (pose.blink ?? 0)) * (pose.mood === "squint" ? 0.4 : 1);
              // Scared: wide eyes, grown about their own centres.
              const big = pose.mood === "scared" ? 1.35 : 1;
              return <path key={side} d={side === "left" ? EYE_L : EYE_R} transform={`translate(${c.x * (1 - big)} ${c.y * (1 - sy * big)}) scale(${big} ${sy * big})`} />;
            })}
            {/* Talking: the beak drops and stretches from its top edge, like a mouth opening. */}
            <path d={BEAK} transform={`translate(0 ${822 * -0.22 * (pose.beak ?? 0)}) translate(0 ${12 * (pose.beak ?? 0)}) scale(1 ${1 + 0.22 * (pose.beak ?? 0)})`} />
          </g>
          {wear.filter((a) => a.slot !== "eyewear").map((a) => <AccessoryPaths key={a.name} acc={a} />)}
          <g transform={`translate(${ex} ${ey})`}>{wear.filter((a) => a.slot === "eyewear").map((a) => <AccessoryPaths key={a.name} acc={a} />)}</g>
        </g>
        )}
      </g>
      <path d={RING} strokeWidth="64" stroke="#16162F" fill="none" />
      {pawsShown && (
        <g filter={`url(#${id}-paw)`} fill="#7C6EC3" opacity={paws} transform={`translate(0 ${(1 - paws) * 90})`}>
          <path d={PAW_L} opacity={left ? 1 - out : 1} />
          <path d={PAW_R} opacity={left ? 1 : 1 - out} />
          {pose.arm > 0.01 && (
            // Turns at the shoulder and travels with the body; tucked, it hangs down the side (120°) as the paw returns.
            <g transform={left ? "translate(1269 0) scale(-1 1)" : undefined}>
              <path
                d={ARM}
                transform={`translate(${70 * (pose.shift ?? 0) * (left ? -1 : 1)} ${dy}) rotate(${(Math.max(-70, Math.min(80, aim)) - ARM_ANGLE) * pose.arm + (120 - ARM_ANGLE) * (1 - pose.arm)} ${PIVOT.x} ${PIVOT.y})`}
                opacity={Math.min(1, pose.arm * 3)}
              />
            </g>
          )}
        </g>
      )}
    </svg>
  );
}
