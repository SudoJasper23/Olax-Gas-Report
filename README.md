# Olax Gas Sales Book

Daily sales and monthly profit reports for the Olax Gas container shop.

- **Salesman** logs in and records each day's gas sold (kg), accessories, cash and transfers. He sees the last 14 days and can save today or the 2 days before.
- **Partners** see everything: the monthly report (sales, cost of gas, salary, expenses, net profit, restocking share and the 50/50 split), and they add expenses.
- **Owner** (Sodeeq) also sets prices, salary and sharing, and creates users and their roles.

Hosting is GitHub Pages (free). Logins and data live in Supabase (free tier).

## Setup (about 15 minutes, once)

### 1. Supabase
1. Create a free project at https://supabase.com.
2. **SQL Editor → New query**: paste all of `schema.sql` and press **Run**.
3. **Authentication → Sign In / Providers → Email**: turn **off** "Confirm email". Leave "Allow new users to sign up" **on** (the Users page needs it; anyone who signs up without a profile gets no access).
4. **Authentication → Users → Add user → Create new user**: email `sodeeq@olaxgas.app`, your password, tick **Auto Confirm User**.
5. Back in **SQL Editor**, run:
   ```sql
   insert into public.profiles (id, username, full_name, role)
   select id, 'sodeeq', 'Sodeeq Gbadegesin', 'owner' from auth.users where email = 'sodeeq@olaxgas.app'
   on conflict (id) do update set role = 'owner', active = true;
   ```
6. **Project Settings → API**: copy the **Project URL** and the **anon public** key into `config.js`.

### 2. GitHub Pages
1. Commit `config.js` with your values and push to `main`.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`, Save.
3. After a minute the link appears at the top of that page (e.g. `https://sudojasper23.github.io/Olax-Gas-Report/`). Every push to `main` republishes it.
   GitHub Pages on a **private** repo needs a paid GitHub plan; on a free plan make the repo public (the data stays private in Supabase).

### 3. First login
Log in with username `sodeeq`. Go to **Settings** and enter real prices, buying cost and salary. Then **Users → Create a user** for Olajumoke (Partner) and the salesman (Salesman), and send each their username and password privately.

## Notes
- Usernames are turned into `username@olaxgas.app` behind the scenes. No email is sent.
- Forgotten password: turn the old account off in **Users** and create a new one (or reset it in Supabase → Authentication → Users).
- The anon key in `config.js` is designed to be public. The database rules in `schema.sql` decide who can read and change what.
- Supabase pauses free projects after a week with no activity. Daily use keeps it awake; if it pauses, press **Restore** in the Supabase dashboard.
