
import { ChannelSkeleton } from "./ChannelSkeleton";
import { SkeletonBase } from "./SkeletonBase";

export const ServerDetailsSkeleton = () => {
  return (
    <div className="flex flex-col items-center justify-between h-full w-full">
      <div className="flex flex-col gap-4 items-center w-full">
        {/* Server header skeleton */}
        <div className="flex flex-col gap-2 items-center w-full">
          <SkeletonBase width="120px" height="24px" borderRadius="var(--gryt-radius-md)" />
          <SkeletonBase width="80px" height="16px" borderRadius="var(--gryt-radius-sm)" />
        </div>

        {/* Channel list skeleton */}
        <ChannelSkeleton />
      </div>
    </div>
  );
};
