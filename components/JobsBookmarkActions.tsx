"use client";

import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import { Button } from "./ui/button";
import { Pencil, Trash } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FormEvent, useState } from "react";
import toast from "react-hot-toast";
import { Input } from "./ui/input";
import AppLoader from "./AppLoader";
import { BookmarkRow } from "@/utils/types";

export default function JobsBookmarkActions({
  bookmark,
  updateLocalItem,
  removeLocalItem,
}: {
  bookmark: BookmarkRow;
  updateLocalItem: (updatedItem: BookmarkRow) => void;
  removeLocalItem: (id: string) => void;
}) {
  const [formLoading, setFormLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [dialogView, setDialogView] = useState<"edit" | "delete">("edit");

  const updateItem = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      setFormLoading(true);
      const supabase = createClient();
      const formData = new FormData(e.currentTarget);
      const name = formData.get("name") as string;
      const url = formData.get("url") as string;
      const { data, error } = await supabase
        .from("bookmarks")
        .update({ name, url })
        .eq("id", bookmark.id)
        .select("*")
        .single();
      if (error) throw error;
      setOpenDialog(false);
      // callbackFunc();
      updateLocalItem(data);
      toast.success("Bookmark updated successfully");
    } catch {
      toast.error("Error updating bookmark");
    } finally {
      setFormLoading(false);
    }
  };

  const deleteItem = async () => {
    try {
      setDeleteLoading(true);
      const supabase = createClient();
      if (bookmark.user_id) {
        const { error } = await supabase
          .from("bookmarks")
          .delete()
          .eq("id", bookmark.id)
          .eq("user_id", bookmark.user_id);
        if (error) throw error;
      }
      // callbackFunc();
      removeLocalItem(bookmark.id);
      setOpenDialog(false);
      setDeleteLoading(false);
    } catch {
      toast.error("Some error occured, please try again later.");
    }
  };

  return (
    <div className="flex items-center gap-1">
      <ResponsiveDialog open={openDialog} onOpenChange={setOpenDialog}>
        <div className="flex items-center gap-2">
          <ResponsiveDialogTrigger asChild>
            <Button
              onClick={() => {
                setOpenDialog(true);
                setDialogView("edit");
              }}
              variant={"ghost"}
              size={"sm"}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </ResponsiveDialogTrigger>
          <ResponsiveDialogTrigger asChild>
            <Button
              onClick={() => {
                setOpenDialog(true);
                setDialogView("delete");
              }}
              variant="ghost"
              size={"sm"}
            >
              <Trash />
            </Button>
          </ResponsiveDialogTrigger>
        </div>

        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="max-w-[200px] truncate text-start">
              {dialogView === "edit" ? "Edit" : "Delete"} &quot;{bookmark.name}
              &quot;
            </ResponsiveDialogTitle>
            {dialogView === "delete" && (
              <ResponsiveDialogDescription className="text-start">
                Are you sure you want to remove this bookmark? This action
                cannot be undone.
              </ResponsiveDialogDescription>
            )}
          </ResponsiveDialogHeader>
          {dialogView === "edit" ? (
            <form className="flex min-h-0 flex-col gap-4" onSubmit={updateItem}>
              <ResponsiveDialogBody className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label htmlFor="name" className="font-medium">
                    Name
                  </label>
                  <Input
                    id="name"
                    name="name"
                    defaultValue={bookmark.name}
                    className="text-sm"
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="url" className="font-medium">
                    URL
                  </label>
                  <Input
                    id="url"
                    name="url"
                    defaultValue={bookmark.url ?? undefined}
                    className="text-sm"
                    required
                  />
                </div>
              </ResponsiveDialogBody>
              <ResponsiveDialogFooter className="gap-2 sm:space-x-0">
                <ResponsiveDialogClose asChild>
                  <Button disabled={formLoading} variant="outline">
                    Cancel
                  </Button>
                </ResponsiveDialogClose>
                <Button disabled={formLoading} type="submit">
                  Save
                  {formLoading && <AppLoader color="secondary" size="sm" />}
                </Button>
              </ResponsiveDialogFooter>
            </form>
          ) : (
            <ResponsiveDialogFooter className="gap-2 sm:space-x-0">
              <ResponsiveDialogClose asChild>
                <Button disabled={deleteLoading} variant="outline">
                  Cancel
                </Button>
              </ResponsiveDialogClose>

              <Button
                onClick={deleteItem}
                disabled={formLoading}
                type="button"
                variant={"destructive"}
              >
                Delete
                {deleteLoading && <AppLoader color="secondary" size="sm" />}
              </Button>
            </ResponsiveDialogFooter>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
