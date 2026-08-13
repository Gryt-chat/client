
import { SkeletonBase } from "./SkeletonBase";

export const ChannelSkeleton = () => {
  return (
    <div className="flex flex-col gap-3 items-center w-full">
      {/* Generate 3-4 skeleton channels */}
      {Array.from({ length: 4 }).map((_, index) => (
        <div className="flex flex-col items-start w-full relative" key={index}>
          {/* Channel button skeleton */}
          <div className="flex items-center gap-2 p-2" style={{
              width: "100%",
              background: "var(--gryt-neutral-3)",
              borderRadius: "var(--gryt-radius-lg)",
              border: "1px solid var(--gryt-neutral-4)",
            }}>
            {/* Icon skeleton */}
            <SkeletonBase width="16px" height="16px" borderRadius="50%" />
            {/* Channel name skeleton */}
            <SkeletonBase 
              width={index % 2 === 0 ? "80px" : "120px"} 
              height="16px" 
            />
          </div>
        </div>
      ))}
    </div>
  );
};
