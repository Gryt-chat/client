import { Flex } from "@radix-ui/themes";

import { SkeletonBase } from "./SkeletonBase";

export const UserSkeleton = () => {
  return (
    <Flex 
      gap="2" 
      align="center" 
      px="3" 
      py="2" 
      width="100%" 
      justify="between"
    >
      <Flex gap="2" align="center">
        {/* Avatar skeleton */}
        <SkeletonBase width="24px" height="24px" borderRadius="50%" />
        {/* Username skeleton */}
        <SkeletonBase width="80px" height="16px" />
      </Flex>

      <Flex gap="1" align="center">
        {/* Status indicators skeleton */}
        <SkeletonBase width="12px" height="12px" borderRadius="50%" />
      </Flex>
    </Flex>
  );
};
