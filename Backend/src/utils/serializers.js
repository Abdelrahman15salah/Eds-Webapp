// The only shape in which a user is ever sent to clients.
export const publicUser = (u) => ({
  id: String(u._id),
  name: u.userName,
  email: u.email,
  role: u.role,
  phoneNumber: u.phoneNumber ?? null,
  isActive: u.isActive,
  authProviders: u.authProviders,
  emailVerified: u.emailVerified,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});
