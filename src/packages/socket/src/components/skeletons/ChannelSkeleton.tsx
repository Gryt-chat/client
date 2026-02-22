import { Flex } from "@radix-ui/themes";

import { SkeletonBase } from "./SkeletonBase";

export const ChannelSkeleton = () => {
  return (
    <Flex direction="column" gap="3" align="center" width="100%">
      {/* Generate 3-4 skeleton channels */}
      {Array.from({ length: 4 }).map((_, index) => (
        <Flex
          key={index}
          direction="column"
          align="start"
          width="100%"
          position="relative"
        >
          {/* Channel button skeleton */}
          <Flex
            align="center"
            gap="2"
            p="2"
            style={{
              width: "100%",
              background: "var(--gray-3)",
              borderRadius: "12px",
              border: "1px solid var(--gray-4)",
            }}
          >
            {/* Icon skeleton */}
            <SkeletonBase width="16px" height="16px" borderRadius="50%" />
            {/* Channel name skeleton */}
            <SkeletonBase 
              width={index % 2 === 0 ? "80px" : "120px"} 
              height="16px" 
            />
          </Flex>
        </Flex>
      ))}
    </Flex>
  );
};
