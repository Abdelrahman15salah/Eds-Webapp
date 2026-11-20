import mongoose from "mongoose";

// All money is stored as integer piasters (100 = 1 EGP). Never floats.
const courseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      minlength: [3, "Title must be at least 3 characters"],
      maxlength: [120, "Title cannot exceed 120 characters"],
    },
    // URL-friendly unique identifier, e.g. "endodontics-101".
    slug: { type: String, trim: true, lowercase: true, maxlength: 90 },
    description: { type: String, trim: true, maxlength: 5000, default: "" },
    category: { type: String, trim: true, maxlength: 60 },
    // Fixed discounted price for enrolling in the whole course (all modules).
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
      validate: { validator: Number.isInteger, message: "Price must be an integer (piasters)" },
    },
    instructors: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

courseSchema.index({ status: 1, createdAt: -1 });
courseSchema.index({ category: 1 });
courseSchema.index({ slug: 1 }, { unique: true, sparse: true });

export const Course = mongoose.model("Course", courseSchema);
