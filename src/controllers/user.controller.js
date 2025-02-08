import { asyncHandler } from "../utils/asyncHandler.js";
import { APIError } from "../utils/APIError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { APIResponse } from "../utils/APIResponse.js";
import { COOKIE_OPTIONS } from "../constants.js";

const generateAccessAndRefreshToken = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;

    await user.save({ validateBeforeSave: false });
    return { accessToken, refreshToken };
  } catch (error) {
    console.log(error);
  }
};

const registerUser = asyncHandler(async (req, res) => {
  /**
   * check if req.body contains all required fields (username, email, password, fullName, avatar)
   * check is username or email is already taken
   * upload user avatar or coverImage(if exists) to cloudinary
   * create user object - create entry in db
   * return response after removing password & refreshtoken
   * check for user creation
   * return response
   *
   */
  const { email, username, fullName, password } = req.body;
  if (
    [email, username, fullName, password]?.some(
      (field) => !field || field.trim() === ""
    )
  ) {
    throw new APIError(400, "Some required fields are missing!");
  }

  const isUserExists = await User.findOne({
    $or: [{ email }, { username }],
  });
  if (isUserExists) {
    console.log("User already exists!");
    throw new APIError(409, "User already exists!");
  }

  const avatarLocalPath = req.files?.avatar?.[0]?.path;
  const coverImageLocalPath =
    req.files?.coverImage && Array.isArray(req.files?.coverImage)
      ? req.files?.coverImage?.[0]?.path
      : req.files?.coverImage?.path || null; // if the field contains single file multer.single("file_path") => path = "string"

  if (!avatarLocalPath) {
    throw new APIError(400, "Avatar file is required!");
  }

  const avatarCloudinaryResponse = await uploadOnCloudinary(avatarLocalPath);
  let coverImageCloudinaryResponse = null;
  if (coverImageLocalPath) {
    coverImageCloudinaryResponse =
      await uploadOnCloudinary(coverImageLocalPath);
  }

  if (!avatarCloudinaryResponse) {
    throw new APIError(500, "Server error: Unable to upload avatar image!");
  }

  const user = await User.create({
    username: username?.toLowerCase(),
    email,
    password,
    fullName,
    avatar: avatarCloudinaryResponse?.url,
    coverImage: coverImageCloudinaryResponse
      ? coverImageCloudinaryResponse?.url
      : "",
  });

  const createdUser = await User.findById(user?._id).select(
    "-password -refreshToken"
  );

  if (!createdUser) {
    throw new APIError(500, "Something went wrong while registering the user!");
  }

  res
    .status(201)
    .json(new APIResponse(200, "User registered successfully!", createdUser));
});

const loginUser = asyncHandler(async (req, res) => {
  /**
   * Get data fromm req.body - username, email, password
   * username or email fields should not be empty
   * check whether user exists with username or email
   * Verify password
   * generate access, refresh token and save refresh token in db
   * return logged in user info along with accessToken.
   */

  const { username, email, password } = req.body;
  if ((!email && !username) || !password) {
    throw new APIError(400, "Email/Username and password are required.");
  }

  const user = await User.findOne({
    $or: [{ email }, { username }],
  });

  if (!user) {
    throw new APIError(401, "User does not exists!");
  }

  const isValidUser = await user.isPasswordCorrect(password);
  if (!isValidUser) {
    throw new APIError(401, "Invalid user crednetials!");
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshToken(
    user?._id
  );

  // this user object does not have refreshToken
  // user is mongodb document not a plain js object. The value inside filteredUserData will be - [ '$__', '$isNew', '_doc' ] _doc contains the actual fields.
  // const filteredUserData = Object.keys(user)?.filter(
  //   (key) => key !== "password" && key !== "refreshToken"
  // );
  const userObject = user.toObject();
  delete userObject.password;
  delete userObject.refreshToken;

  console.log("User logged in successfully: ", userObject);
  return res
    .status(200)
    .cookie("accessToken", accessToken, COOKIE_OPTIONS)
    .cookie("refreshToken", refreshToken, COOKIE_OPTIONS)
    .json(
      new APIResponse(
        200,
        {
          user: userObject,
          accessToken,
          refreshToken,
        },
        "User logged in successfully!"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req?.user?._id,
    {
      $unset: {
        refreshToken: 1,
      },
    },
    { new: true }
  );

  if (!user) {
    throw new APIError(500, "Internal server error");
  }

  return res
    .status(200)
    .clearCookie("accessToken", COOKIE_OPTIONS)
    .clearCookie("refreshToken", COOKIE_OPTIONS)
    .json(new APIResponse(200, "User logged out successfully!"));
});

export { registerUser, loginUser, logoutUser };
