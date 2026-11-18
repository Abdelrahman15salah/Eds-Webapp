import mongoose from "mongoose";

const moduleSchema = new mongoose.Schema(
  {
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      minlength: [3, "Title must be at least 3 characters"],
      maxlength: [120, "Title cannot exceed 120 characters"],
    },
    description: { type: String, trim: true, maxlength: 5000, default: "" },
    // Integer piasters (100 = 1 EGP).
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
      validate: { validator: Number.isInteger, message: "Price must be an integer (piasters)" },
    },
    // 1-based position inside the course.
    order: { type: Number, required: true, min: 1 },
    // Optional modules are a bonus: they do not affect course completion.
    isRequired: { type: Boolean, default: true },
    instructors: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    status: { type: String, enum: ["draft", "published"], default: "draft" },
  },
  { timestamps: true },
);

moduleSchema.index({ course: 1, order: 1 });
moduleSchema.index({ instructors: 1 });

export const Module = mongoose.model("Module", moduleSchema);
