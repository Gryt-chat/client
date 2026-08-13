
import { SkeletonBase } from "./SkeletonBase";

export const UserSkeleton = () => {
  return (
    <div className="flex gap-2 items-center px-3 py-2 w-full justify-between">
      <div className="flex gap-2 items-center">
        {/* Avatar skeleton */}
        <SkeletonBase width="24px" height="24px" borderRadius="50%" />
        {/* Username skeleton */}
        <SkeletonBase width="80px" height="16px" />
      </div>

      <div className="flex gap-1 items-center">
        {/* Status indicators skeleton */}
        <SkeletonBase width="12px" height="12px" borderRadius="50%" />
      </div>
    </div>
  );
};
