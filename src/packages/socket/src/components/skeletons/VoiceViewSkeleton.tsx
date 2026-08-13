
import { SkeletonBase } from "./SkeletonBase";

export const VoiceViewSkeleton = () => {
  return (
    <div className="flex h-full w-full flex-col p-3" style={{
        background: "var(--gray-3)",
        borderRadius: "var(--radius-5)",
      }}>
      <div className="flex flex-col gap-4 justify-center items-center grow relative">
        {/* Generate 2-3 skeleton users */}
        {Array.from({ length: 3 }).map((_, index) => (
          <div className="flex items-center justify-center flex-col gap-1 px-12 py-4" key={index} style={{
              background: "var(--gray-3)",
              borderRadius: "var(--radius-5)",
              border: "1px solid var(--gray-4)",
            }}>
            <div className="flex items-center justify-center relative">
              {/* Avatar skeleton */}
              <SkeletonBase width="48px" height="48px" borderRadius="50%" />
            </div>
            <div className="flex flex-col items-center gap-1">
              {/* Username skeleton */}
              <SkeletonBase 
                width={index % 2 === 0 ? "60px" : "80px"} 
                height="16px" 
              />
            </div>
          </div>
        ))}

        {/* Controls skeleton at bottom */}
        <div className="flex" style={{
            width: "100%",
            position: "absolute",
            bottom: "0",
            display: "flex",
            justifyContent: "center",
            padding: "24px",
          }}>
          <SkeletonBase width="120px" height="40px" borderRadius="var(--radius-4)" />
        </div>
      </div>
    </div>
  );
};
