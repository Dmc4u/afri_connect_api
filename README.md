# afri_onet_api

How to Generate Them (Securely)

You can create both secrets easily in your terminal:

✅ Option 1: Use Node.js

Run this in your terminal:

node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

This will print something like:

a3f94d57e13bb4e7e5a0e88a2c14b87e6b7f8d6e0a13ad5bbd6a02a7c5e45bce...

Now you have a secure random key.

Do this twice — one for each variable:

JWT_SECRET

JWT_SESSION_SECRET

🧾 3. Add Them to .env
