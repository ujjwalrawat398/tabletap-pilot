import { redirect } from 'next/navigation';
import { getStaffUser } from '@/server/auth';
import { STAFF_HOME } from '@/lib/constants';
import { LoginForm } from '@/components/staff/LoginForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff sign in' };

export default async function LoginPage() {
  const user = await getStaffUser();
  if (user) redirect(STAFF_HOME[user.role]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-6">
      <div className="mb-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-xl font-black text-primary-foreground">
          T
        </div>
        <h1 className="mt-3 text-2xl font-bold">Staff sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Waiter, kitchen and admin access. Guests do not need an account.
        </p>
      </div>
      <LoginForm />
    </main>
  );
}
