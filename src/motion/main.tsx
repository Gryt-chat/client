import "../style.css";
import "./electronStub";

import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import { Film } from "./Film";
import { H, setStageScale, W } from "./stage";

/** Fits the 1920×1080 stage to the window when previewing; a render sets the window to exactly that. */
function Fit() {
  const [s, setS] = useState(1);
  useEffect(() => {
    const fit = () => {
      const v = Math.min(window.innerWidth / W, window.innerHeight / H);
      setS(v);
      setStageScale(v);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div style={{ width: W * s, height: H * s, overflow: "hidden" }}>
      <div style={{ transform: `scale(${s})`, transformOrigin: "0 0" }}>
        <Film />
      </div>
    </div>
  );
}

// The film draws its own caret (caret.tsx); the browser's one blinks on wall time.
document.head.insertAdjacentHTML("beforeend", "<style>#stage * { caret-color: transparent !important; }</style>");

ReactDOM.createRoot(document.getElementById("root")!).render(<Fit />);
