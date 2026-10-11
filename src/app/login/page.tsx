import Link from "next/link";
import AuthForm from "../AuthForm";
import { logIn } from "../actions";

export default function LoginPage() {
  return (
    <main className="narrow">
      <h1>Log in</h1>
      <AuthForm action={logIn} submitLabel="Log in" />
      <p>
        New here? <Link href="/signup">Create an account</Link>
      </p>
    </main>
  );
}
