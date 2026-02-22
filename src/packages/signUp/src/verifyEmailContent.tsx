import { Flex, Heading, Text } from "@radix-ui/themes";

export function VerifyEmailContent() {
  return (
    <Flex direction="column" gap="1" width="280px" align="center">
      <Heading color="violet" style={{ textAlign: "center" }}>
        Welcome to the club!
      </Heading>
      <Text weight="medium">We've sent you an email</Text>
      <Text
        size="1"
        style={{
          opacity: 0.75,
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        Please read it now
        <img
          width={16}
          height={16}
          src="/emote/pepegun.png"
          alt="Pepe holding a gun"
        />
      </Text>
    </Flex>
  );
}
