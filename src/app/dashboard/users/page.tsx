import UsersClient from "./UsersClient";


// Render client component directly — data is fetched client-side
// to avoid server-side DB calls that cause redirect loops on slow drives.
export default function UsersPage() {
  return <UsersClient initialProfiles={[]} />;
}
