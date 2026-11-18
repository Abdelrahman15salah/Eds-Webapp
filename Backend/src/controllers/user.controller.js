import { User } from "../models/User.model.js";
import { RefreshToken } from "../models/RefreshToken.model.js";
import { forbidden, AppError } from "../utils/AppError.js";
import { publicUser } from "../utils/serializers.js";
import { revokeAllSessions } from "../services/session.service.js";
import { listUsersQuery, objectId } from "../validators/user.validators.js";

import { escapeRegex } from "../utils/regex.js";

export const listUsers = async (req, res) => {
  const { role, isActive, search, page, limit, sort } = listUsersQuery.parse(req.query);

  const filter = {};
  if (role) filter.role = { $in: role };
  if (isActive !== undefined) filter.isActive = isActive;
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ userName: rx }, { email: rx }];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort(sort.startsWith("-") ? { [sort.slice(1)]: -1, _id: -1 } : { [sort]: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      users: users.map(publicUser),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
  });
};

const loadTarget = async (req) => {
  const id = objectId.parse(req.params.id);
  const user = await User.findById(id);
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
  return user;
};

export const getUser = async (req, res) => {
  res.json({ success: true, data: { user: publicUser(await loadTarget(req)) } });
};

export const updateUser = async (req, res) => {
  const user = await loadTarget(req);
  const { role, isActive, name, phoneNumber } = req.body;
  const isSelf = String(user._id) === String(req.user._id);

  // Prevents an admin from locking themselves (or the system) out.
  if (isSelf && (role !== undefined || isActive !== undefined)) {
    throw forbidden("You cannot change your own role or active status", "CANNOT_MODIFY_SELF");
  }

  if (role !== undefined) user.role = role;
  if (isActive !== undefined) user.isActive = isActive;
  if (name !== undefined) user.userName = name;
  if (phoneNumber !== undefined) user.phoneNumber = phoneNumber ?? undefined;
  await user.save();

  // A deactivated account loses all of its sessions immediately.
  if (isActive === false) await revokeAllSessions(user._id);

  res.json({ success: true, data: { user: publicUser(user) } });
};

// Permanent deletion (use PATCH isActive=false for a reversible alternative).
export const deleteUser = async (req, res) => {
  const user = await loadTarget(req);
  if (String(user._id) === String(req.user._id)) {
    throw forbidden("You cannot delete your own account here", "CANNOT_MODIFY_SELF");
  }
  await RefreshToken.deleteMany({ user: user._id });
  await user.deleteOne();
  res.json({ success: true, data: { message: "User deleted" } });
};
