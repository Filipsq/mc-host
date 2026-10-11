import type { Messages } from "../messages";

const en: Messages = {
  meta: {
    description: "Free and paid Minecraft server hosting for Java and Bedrock",
  },
  nav: {
    language: "Language",
    currency: "Currency",
    logIn: "Log in",
    dashboard: "My servers",
  },
  home: {
    title: "Minecraft servers in one click",
    subtitle:
      "Host a Java or Bedrock server for free, or upgrade for more players and always-on uptime.",
    cta: "Get started free",
    pricingTitle: "Pricing",
    perMonth: "/ month",
  },
  plans: {
    FREE: "Free",
    STARTER: "Starter",
    STANDARD: "Standard",
    PRO: "Pro",
    ram: "{gb} GB RAM",
    players: "Up to {n} players",
    unlimitedPlayers: "Unlimited players",
    sleeps: "Sleeps when nobody is playing",
    alwaysOn: "Always on",
    noBackups: "No backups",
    backups: "Backups: last {n} kept",
  },
  auth: {
    email: "Email",
    password: "Password",
    wait: "Please wait...",
    signUpTitle: "Create your account",
    signUpSubmit: "Sign up",
    haveAccount: "Already have an account?",
    logInTitle: "Log in",
    logInSubmit: "Log in",
    newHere: "New here?",
    createAccount: "Create an account",
    errors: {
      invalidEmail: "Enter a valid email address",
      passwordTooShort: "Password must be at least 8 characters",
      emailTaken: "An account with that email already exists",
      wrongCredentials: "Wrong email or password",
    },
  },
  dashboard: {
    title: "Your servers",
    logOut: "Log out",
    signedInAs: "Signed in as {email}",
    empty: "You don't have any servers yet. Server creation is coming in the next step.",
    status: {
      PROVISIONING: "Setting up",
      RUNNING: "Running",
      SLEEPING: "Sleeping",
      STOPPED: "Stopped",
      SUSPENDED: "Suspended",
    },
  },
};

export default en;
