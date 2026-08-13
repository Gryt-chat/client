import { Chip } from "@gryt/ui";
import { DataList, Flex, Text } from "@radix-ui/themes";

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

/**
 * A rename described by when and how often, never by what it used to say.
 *
 * A recent rename is the thing worth noticing — an account that became this
 * name an hour ago is worth a second look in a way that one which has held it
 * for a year is not. Past names would answer a question nobody is asking here,
 * at the cost of publishing something somebody may have had a good reason to
 * change.
 */
function describeRenames(count?: number, at?: string | null): string | null {
  if (!count || count < 1) return null;

  const times = count === 1 ? "Renamed once" : `Renamed ${count} times`;
  if (!at) return times;

  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return times;

  const minutes = Math.floor((Date.now() - when.getTime()) / 60_000);
  if (minutes < 60) return `${times}, last just now`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${times}, last ${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) return `${times}, last ${days} day${days === 1 ? "" : "s"} ago`;

  return `${times}, last ${when.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })}`;
}

export function MemberIdentityCard({ member }: { member: MemberInfo }) {
  const joined = formatJoined(member.createdAt);
  const tier = member.identityTier ? TIER_LABEL[member.identityTier] : undefined;
  const renames = describeRenames(
    member.nicknameChangeCount,
    member.nicknameChangedAt,
  );

  return (
    <Flex direction="column" gap="2" style={{ maxWidth: 260 }}>
      <Flex align="center" gap="2" wrap="wrap">
        <Text size="2" weight="bold">
          {member.nickname}
        </Text>
        {member.role && member.role !== "member" && (
          <Chip tone="neutral">
            {member.role}
          </Chip>
        )}
      </Flex>

      <DataList.Root size="1" orientation="vertical">
        {tier && (
          <DataList.Item>
            <DataList.Label>Identity</DataList.Label>
            <DataList.Value>
              <Chip tone="neutral" color={tier.color}>
                {tier.label}
              </Chip>
            </DataList.Value>
          </DataList.Item>
        )}

        {joined && (
          <DataList.Item>
            <DataList.Label>Joined</DataList.Label>
            <DataList.Value>{joined}</DataList.Value>
          </DataList.Item>
        )}

        {renames && (
          <DataList.Item>
            <DataList.Label>Name</DataList.Label>
            <DataList.Value>{renames}</DataList.Value>
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
              <code
                className="font-mono text-xs text-gryt-muted"
                style={{ overflowWrap: "anywhere", userSelect: "all" }}
              >
                {member.identityFingerprint}
              </code>
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
