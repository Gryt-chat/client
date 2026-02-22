import React, { useCallback, useEffect, useRef } from "react";

type VisualizerProps = {
  analyser: AnalyserNode;
  visualSetting: "sinewave" | "frequencybars";
  width?: number;
  height?: number;
  barsColor?: string;
};

function resolveColor(color: string, element: HTMLElement | null): string {
  if (!color.startsWith("var(") || !element) return color;
  const resolved = getComputedStyle(element).getPropertyValue(
    color.slice(4, -1).trim()
  );
  return resolved.trim() || color;
}

export const Visualizer: React.FC<VisualizerProps> = ({
  analyser,
  visualSetting,
  width = 482,
  height = 64,
  barsColor,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawVisualRef = useRef<number>();

  const visualize = useCallback(() => {
    const canvas = canvasRef.current;
    const canvasCtx = canvas?.getContext("2d");
    if (!canvas || !canvasCtx) return;

    const effectiveColor = resolveColor(
      barsColor || "var(--accent-9)",
      canvas.closest(".radix-themes") as HTMLElement
    );

    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    if (!analyser) return;
    analyser.fftSize = 256;
    const bufferLengthAlt = analyser.frequencyBinCount;
    const dataArrayAlt = new Uint8Array(bufferLengthAlt);

    const drawAlt = () => {
      drawVisualRef.current = requestAnimationFrame(drawAlt);

      analyser.getByteFrequencyData(dataArrayAlt);

      canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

      const barWidth = WIDTH / bufferLengthAlt;
      let x = 0;

      for (let i = 0; i < bufferLengthAlt; i++) {
        const barHeight = dataArrayAlt[i];

        canvasCtx.fillStyle = effectiveColor;
        canvasCtx.fillRect(x, HEIGHT - barHeight / 2, barWidth, barHeight / 2);

        x += barWidth + 1;
      }
    };

    drawAlt();
  }, [analyser, barsColor]);

  useEffect(() => {
    if (drawVisualRef.current) {
      cancelAnimationFrame(drawVisualRef.current);
    }
    visualize();
  }, [visualSetting, barsColor, visualize]);

  return <canvas ref={canvasRef} width={width} height={height} />;
};
