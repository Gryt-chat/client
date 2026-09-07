
import { Skeleton } from "@gryt/ui";

export const UserSkeleton = () => {
  return (
    <div className="flex gap-2 items-center px-3 py-2 w-full justify-between">
      <div className="flex gap-2 items-center">
        {/* Avatar skeleton */}
        <Skeleton variant="circular" width="24px" height="24px" />
        {/* Username skeleton */}
        <Skeleton width="80px" height="16px" />
      </div>

      <div className="flex gap-1 items-center">
        {/* Status indicators skeleton */}
        <Skeleton variant="circular" width="12px" height="12px" />
      </div>
    </div>
  );
};
