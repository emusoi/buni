// Who did something, as the person reads it. The file records their own edits as "you"; shown, that is their name
// where the account knows it, else You. Agents keep their names.
import { useAccount } from "./Profile.tsx";

export function useWho(): (author: string) => string {
  const account = useAccount();
  const me = account.state === "signed-in" ? account.person.name : "You";
  return (author) => (author === "you" ? me : author);
}
