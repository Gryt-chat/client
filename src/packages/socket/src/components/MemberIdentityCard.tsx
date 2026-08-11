import { Badge, Code, DataList, Flex, Text } from "@radix-ui/themes";

import type { MemberInfo } from "./MemberSidebar";

/**
 * What a member list can say about somebody beyond their chosen name.
 *
 * Nicknames are not unique and never have been, so "Sivert" in the sidebar is a
 * claim rather than a fact. These are the parts of that claim nobody can pick:
 * when the account first joined *this* server, whether there is an account
 * behind it at all, and a marker that stays the same across renames.
 */

function formatJoined(value?: string | Date): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const TIER_LABEL: Record<string, { label: string; color: "gray" | "amber" }> = {
  account: { label: "Gryt account", color: "gray" },
  local: { label: "No account", color: "amber" },
};

export function MemberIdentityCard({ member }: { member: MemberInfo }) {
  const joined = formatJoined(member.createdAt);
  const tier = member.identityTier ? TIER_LABEL[member.identityTier] : undefined;

  return (
    <Flex direction="column" gap="2" style={{ maxWidth: 260 }}>
      <Flex align="center" gap="2" wrap="wrap">
        <Text size="2" weight="bold">
          {member.nickname}
        </Text>
        {member.role && member.role !== "member" && (
          <Badge size="1" variant="soft">
            {member.role}
          </Badge>
        )}
      </Flex>

      <DataList.Root size="1" orientation="vertical">
        {tier && (
          <DataList.Item>
            <DataList.Label>Identity</DataList.Label>
            <DataList.Value>
              <Badge size="1" color={tier.color} variant="soft">
                {tier.label}
              </Badge>
            </DataList.Value>
          </DataList.Item>
        )}

        {joined && (
          <DataList.Item>
            <DataList.Label>Joined</DataList.Label>
            <DataList.Value>{joined}</DataList.Value>
          </DataList.Item>
        )}

        {member.identityFingerprint && (
          <DataList.Item>
            <DataList.Label>Fingerprint</DataList.Label>
            <DataList.Value>
              {/*
                Shown whole rather than shortened. A local identity is a keypair
                its holder makes, so a few characters could be ground out to
                match somebody worth impersonating — the server keys the
                fingerprint so that cannot be done offline, and the full value
                is what makes comparing it mean anything.
              */}
              <Code
                size="1"
                variant="ghost"
                style={{ overflowWrap: "anywhere", userSelect: "all" }}
              >
                {member.identityFingerprint}
              </Code>
            </DataList.Value>
          </DataList.Item>
        )}
      </DataList.Root>

      <Text size="1" color="gray">
        Names are not unique. Check the fingerprint if it matters.
      </Text>
    </Flex>
  );
}
