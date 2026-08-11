import { Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";

import {
  getMergeChoice,
  listLocalIdentityHosts,
  setMergeChoice,
  useAccount,
} from "@/common";

/**
 * Asked once, after signing in, when this device already has identities of its
 * own.
 *
 * The server will hand a membership over to an account that proves it holds the
 * key that membership belonged to. Doing that without asking is right on your
 * own machine and wrong on a shared one, where the guest identity is whoever
 * used it last and an account would silently inherit their servers — including
 * anything they own.
 *
 * One question, not one per server. Somebody signing in does not want a queue
 * of prompts, and the answer is the same for all of them: is this device yours?
 */
export function IdentityMergePrompt() {
  const { isSignedIn } = useAccount();
  const [hosts, setHosts] = useState<string[] | null>(null);

  useEffect(() => {
    if (!isSignedIn || getMergeChoice() !== "unanswered") {
      setHosts(null);
      return;
    }

    let cancelled = false;
    listLocalIdentityHosts()
      .then((found) => {
        // Nothing to bring across means nothing to ask about. The choice is
        // left unanswered rather than defaulted, so joining a server as a guest
        // later still gets the question.
        if (!cancelled && found.length > 0) setHosts(found);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  const answer = (choice: "yes" | "no") => {
    setMergeChoice(choice);
    setHosts(null);
  };

  const count = hosts?.length ?? 0;

  return (
    <Dialog.Root open={count > 0}>
      <Dialog.Content maxWidth="440px">
        <Dialog.Title>Bring your servers with you?</Dialog.Title>
        <Dialog.Description size="2" mb="3">
          You joined {count} server{count === 1 ? "" : "s"} on this device
          before signing in. They can move to your account, keeping your roles
          and anything you own.
        </Dialog.Description>

        <Flex direction="column" gap="2" mb="4">
          {hosts?.slice(0, 5).map((host) => (
            <Text key={host} size="1" color="gray">
              {host}
            </Text>
          ))}
          {count > 5 && (
            <Text size="1" color="gray">
              and {count - 5} more
            </Text>
          )}
        </Flex>

        <Text size="1" color="gray">
          Only say yes if this device is yours. On a shared one, those servers
          belong to whoever used it before you.
        </Text>

        <Flex gap="3" mt="4" justify="end">
          <Button variant="soft" color="gray" onClick={() => answer("no")}>
            Keep them separate
          </Button>
          <Button onClick={() => answer("yes")}>Bring them over</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
