import Link from "next/link";
import AuthForm from "../AuthForm";
import { signUp } from "../actions";

export default function SignUpPage() {
  return (
    <main className="narrow">
      <h1>Create your account</h1>
      <AuthForm action={signUp} submitLabel="Sign up" />
      <p>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
