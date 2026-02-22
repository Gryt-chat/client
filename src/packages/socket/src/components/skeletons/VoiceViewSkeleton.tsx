import { Flex } from "@radix-ui/themes";

import { SkeletonBase } from "./SkeletonBase";

export const VoiceViewSkeleton = () => {
  return (
    <Flex
      style={{
        background: "var(--gray-3)",
        borderRadius: "12px",
      }}
      height="100%"
      width="100%"
      direction="column"
      p="3"
    >
      <Flex
        direction="column"
        gap="4"
        justify="center"
        align="center"
        flexGrow="1"
        position="relative"
      >
        {/* Generate 2-3 skeleton users */}
        {Array.from({ length: 3 }).map((_, index) => (
          <Flex
            key={index}
            align="center"
            justify="center"
            direction="column"
            gap="1"
            px="8"
            py="4"
            style={{
              background: "var(--gray-3)",
              borderRadius: "12px",
              border: "1px solid var(--gray-4)",
            }}
          >
            <Flex align="center" justify="center" position="relative">
              {/* Avatar skeleton */}
              <SkeletonBase width="48px" height="48px" borderRadius="50%" />
            </Flex>
            <Flex direction="column" align="center" gap="1">
              {/* Username skeleton */}
              <SkeletonBase 
                width={index % 2 === 0 ? "60px" : "80px"} 
                height="16px" 
              />
            </Flex>
          </Flex>
        ))}

        {/* Controls skeleton at bottom */}
        <Flex
          style={{
            width: "100%",
            position: "absolute",
            bottom: "0",
            display: "flex",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <SkeletonBase width="120px" height="40px" borderRadius="8px" />
        </Flex>
      </Flex>
    </Flex>
  );
};
