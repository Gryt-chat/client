
import { Skeleton } from "@gryt/ui";

import { ChannelSkeleton } from "./ChannelSkeleton";

export const ServerDetailsSkeleton = () => {
  return (
    <div className="flex flex-col items-center justify-between h-full w-full">
      <div className="flex flex-col gap-4 items-center w-full">
        {/* Server header skeleton */}
        <div className="flex flex-col gap-2 items-center w-full">
          <Skeleton className="rounded-(--gryt-radius-md)" width="120px" height="24px" />
          <Skeleton width="80px" height="16px" />
        </div>

        {/* Channel list skeleton */}
        <ChannelSkeleton />
      </div>
    </div>
  );
};
