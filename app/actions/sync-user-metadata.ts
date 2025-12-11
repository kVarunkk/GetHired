// "use server";

// import { createServiceRoleClient } from "@/lib/supabase/service-role";
// // Assume this path points to the existing Server Action utility
// import { updateUserAppMetadata } from "./update-user-metadata";

// /**
//  * Iterates through all users in the user_info table and synchronizes the
//  * database 'filled' status with the JWT 'onboarding_complete' metadata flag.
//  * * NOTE: This is an administrative function and requires the Service Role.
//  * It is best called manually or via a secure, internal API route.
//  * * @returns A summary of the synchronization process.
//  */
// export async function syncUserOnboardingMetadata() {
//   console.log("Starting user metadata synchronization...");

//   const serviceRoleSupabase = createServiceRoleClient();

//   try {
//     // 1. Fetch all users from the user_info table
//     const { data: users, error: fetchError } = await serviceRoleSupabase
//       .from("company_info")
//       .select("user_id, filled"); // Only need the ID and the filled status

//     if (fetchError) {
//       console.error("DB Fetch Error during sync:", fetchError);
//       return {
//         success: false,
//         message: `Database query failed: ${fetchError.message}`,
//       };
//     }

//     if (!users || users.length === 0) {
//       return {
//         success: true,
//         message: "Synchronization complete: 0 users found.",
//       };
//     }

//     // 2. Map users to concurrent update promises
//     const updatePromises = users.map((user) => {
//       const dataToUpdate = {
//         type: "company", // Hardcode role for user_info table entries
//         onboarding_complete: user.filled,
//         // Add other necessary flags if your middleware depends on them:
//         // is_applicant: true,
//         // applicant_filled: user.filled,
//       };

//       // Call the existing Server Action for each user
//       return updateUserAppMetadata(user.user_id, dataToUpdate)
//         .catch((e) => {
//           // Catch internal errors from the Server Action to ensure Promise.allSettled works
//           console.log(String(e));
//           return {
//             error: `Failed to update metadata: ${e instanceof Error ? e.message : String(e)}`,
//           };
//         })
//         .then((result) => ({
//           userId: user.user_id,
//           success: !result.error,
//           error: result.error,
//         }));
//     });

//     // 3. Execute all updates concurrently
//     const results = await Promise.allSettled(updatePromises);

//     // 4. Summarize results
//     let successfulUpdates = 0;
//     const failedUpdates: { userId: string; error: string }[] = [];

//     results.forEach((result) => {
//       if (result.status === "fulfilled" && result.value.success) {
//         successfulUpdates++;
//       } else if (result.status === "fulfilled" && result.value.error) {
//         failedUpdates.push({
//           userId: result.value.userId,
//           error: result.value.error,
//         });
//       } else if (result.status === "rejected") {
//         // Should be rare if the catch block above is working correctly
//         failedUpdates.push({
//           userId: "Unknown",
//           error: (result.reason as Error).message,
//         });
//       }
//     });

//     const totalUsers = users.length;
//     const totalFailed = failedUpdates.length;

//     console.log(
//       `Sync complete: ${successfulUpdates}/${totalUsers} successful.`
//     );

//     console.log(failedUpdates.map((each) => each.error));

//     return {
//       success: true,
//       message: `Synchronization complete. Total users: ${totalUsers}. Successful: ${successfulUpdates}, Failed: ${totalFailed}.`,
//       failures: failedUpdates,
//     };
//   } catch (e) {
//     const errorMessage =
//       e instanceof Error
//         ? e.message
//         : "Unexpected global error during synchronization.";
//     console.error("Fatal Synchronization Error:", e);
//     return { success: false, message: errorMessage };
//   }
// }
