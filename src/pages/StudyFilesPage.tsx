import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { StudyFile } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  FileText,
  Plus,
  Download,
  Trash2,
  File,
  FileImage,
  Loader2,
} from "lucide-react";

export default function StudyFilesPage() {
  const { user } = useAuth();
  const [files, setFiles] = useState<StudyFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Ensure storage buckets exist
    ensureStorageBuckets();
    fetchFiles();

    // Set up realtime subscription for file changes
    const subscription = supabase
      .channel("study_files_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "study_files" },
        () => fetchFiles(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  const ensureStorageBuckets = async () => {
    try {
      // Check if study_files bucket exists
      const { data: buckets, error } = await supabase.storage.listBuckets();

      if (error) {
        console.error("Error checking buckets:", error);
        // Try to create buckets using edge function
        await supabase.functions.invoke("create_storage_buckets");
        return;
      }

      const studyFilesBucketExists = buckets.some(
        (bucket) => bucket.name === "study_files",
      );

      if (!studyFilesBucketExists) {
        // Create bucket using edge function
        await supabase.functions.invoke("create_storage_buckets");
      }
    } catch (err) {
      console.error("Error ensuring storage buckets exist:", err);
    }
  };

  const fetchFiles = async () => {
    setLoading(true);
    try {
      // Fetch files directly from storage
      const { data: storageData, error: storageError } = await supabase.storage
        .from("study_files")
        .list();

      if (storageError) {
        console.error("Error fetching files from storage:", storageError);
        setFiles(demoFiles);
        return;
      }

      if (storageData && storageData.length > 0) {
        // Transform storage data to our StudyFile type
        const transformedFiles: StudyFile[] = await Promise.all(
          storageData.map(async (file) => {
            // Get public URL for each file
            const { data: urlData } = supabase.storage
              .from("study_files")
              .getPublicUrl(file.name);

            // Try to get metadata from database if it exists
            const { data: metaData } = await supabase
              .from("study_files")
              .select("*")
              .eq("path", file.name)
              .maybeSingle();

            return {
              id: file.id || Date.now().toString() + Math.random().toString(),
              name: metaData?.name || file.name,
              url: urlData.publicUrl,
              type: metaData?.type || getMimeType(file.name),
              size: file.metadata?.size || 0,
              uploadedBy: metaData?.uploaded_by || "Unknown",
              uploadedAt:
                metaData?.uploaded_at ||
                file.created_at ||
                new Date().toISOString(),
            };
          }),
        );

        // Sort by upload date (newest first)
        transformedFiles.sort(
          (a, b) =>
            new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
        );

        setFiles(transformedFiles);
      } else {
        // Also try to fetch from database as fallback
        const { data: dbData, error: dbError } = await supabase
          .from("study_files")
          .select("*")
          .order("uploaded_at", { ascending: false });

        if (!dbError && dbData && dbData.length > 0) {
          const transformedFiles: StudyFile[] = dbData.map((file) => ({
            id: file.id,
            name: file.name,
            url: file.url,
            type: file.type,
            size: file.size,
            uploadedBy: file.uploaded_by,
            uploadedAt: file.uploaded_at,
          }));

          setFiles(transformedFiles);
        } else {
          setFiles([]);
        }
      }
    } catch (err) {
      console.error("Error in fetchFiles:", err);
      setFiles(demoFiles);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to guess MIME type from filename
  const getMimeType = (filename: string): string => {
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      txt: "text/plain",
      zip: "application/zip",
      mp3: "audio/mpeg",
      mp4: "video/mp4",
    };

    return ext && mimeTypes[ext] ? mimeTypes[ext] : "application/octet-stream";
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !user) return;

    setUploading(true);
    setError(null);

    try {
      // 1. Upload file to Supabase Storage
      const fileExt = selectedFile.name.split(".").pop();
      const fileName = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}.${fileExt}`;
      const filePath = fileName;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("study_files")
        .upload(filePath, selectedFile);

      if (uploadError) {
        setError(`Upload failed: ${uploadError.message}`);
        setUploading(false);
        return;
      }

      // 2. Get the public URL
      const { data: publicUrlData } = supabase.storage
        .from("study_files")
        .getPublicUrl(filePath);

      const publicUrl = publicUrlData.publicUrl;

      // 3. Store metadata in the database
      const fileData = {
        name: selectedFile.name,
        path: filePath,
        url: publicUrl,
        type: selectedFile.type,
        size: selectedFile.size,
        uploaded_by: user.displayName,
        uploaded_at: new Date().toISOString(),
      };

      const { data: dbData, error: dbError } = await supabase
        .from("study_files")
        .insert([fileData])
        .select();

      if (dbError) {
        console.error("Error storing file metadata:", dbError);
        // Continue anyway since the file is uploaded
      }

      // 4. Create new file object for local state
      const newFile: StudyFile = {
        id: dbData?.[0]?.id || Date.now().toString(),
        name: selectedFile.name,
        url: publicUrl,
        type: selectedFile.type,
        size: selectedFile.size,
        uploadedBy: user.displayName,
        uploadedAt: new Date().toISOString(),
      };

      // 5. Add to local state
      setFiles([newFile, ...files]);

      // 6. Reset form
      setSelectedFile(null);
      setIsDialogOpen(false);
    } catch (err) {
      console.error("Error in handleUpload:", err);
      setError(`Upload failed: ${err.message || "Unknown error"}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteFile = async (id: string) => {
    try {
      const fileToDelete = files.find((file) => file.id === id);
      if (!fileToDelete) return;

      // Extract filename from URL
      const url = new URL(fileToDelete.url);
      const pathParts = url.pathname.split("/");
      const filename = pathParts[pathParts.length - 1];

      // 1. Delete from Supabase Storage
      const { error: storageError } = await supabase.storage
        .from("study_files")
        .remove([filename]);

      if (storageError) {
        console.error("Error deleting file from storage:", storageError);
      }

      // 2. Try to delete from database if it exists there
      const { error: dbError } = await supabase
        .from("study_files")
        .delete()
        .eq("path", filename);
      
      if (dbError) {
        console.error("Error deleting from database:", dbError);
      }

      // 3. Update local state
      setFiles(files.filter((file) => file.id !== id));
    } catch (error) {
      console.error("Error in handleDeleteFile:", error);
      // Still update local state even if delete fails
      setFiles(files.filter((file) => file.id !== id));
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " bytes";
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    else return (bytes / 1048576).toFixed(1) + " MB";
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.includes("pdf")) {
      return <FileText className="h-10 w-10 text-red-500" />;
    } else if (fileType.includes("image")) {
      return <FileImage className="h-10 w-10 text-blue-500" />;
    } else if (fileType.includes("word") || fileType.includes("document")) {
      return <FileText className="h-10 w-10 text-indigo-500" />;
    } else {
      return <File className="h-10 w-10 text-gray-500" />;
    }
  };

  if (loading) {
    return (
      <DashboardLayout activeTab="study-files">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout activeTab="study-files">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Study Files</h1>
            <p className="text-muted-foreground">
              Share and access study materials and documents.
            </p>
          </div>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Upload File
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload Study File</DialogTitle>
                <DialogDescription>
                  Share study materials with your classmates. Max file size:
                  100MB.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="file">Select File</Label>
                  <Input id="file" type="file" onChange={handleFileChange} />
                  {selectedFile && (
                    <p className="text-sm text-muted-foreground">
                      Selected: {selectedFile.name} (
                      {formatFileSize(selectedFile.size)})
                    </p>
                  )}
                </div>

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                  disabled={uploading}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={!selectedFile || uploading}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>Upload</>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {files.length === 0 ? (
          <div className="text-center p-12 border rounded-lg bg-muted/20">
            <File className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">No files uploaded yet</h3>
            <p className="text-muted-foreground mb-4">
              Upload study materials to share with your classmates
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Upload First File
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {files.map((file) => (
              <Card key={file.id} className="overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-xl line-clamp-1">
                      {file.name}
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleDeleteFile(file.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <CardDescription>{formatFileSize(file.size)}</CardDescription>
                </CardHeader>
                <CardContent className="pb-2">
                  <div className="flex items-center justify-center py-4">
                    {getFileIcon(file.type)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Uploaded by {file.uploadedBy} on{" "}
                    {formatDate(file.uploadedAt)}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => window.open(file.url, "_blank")}
                  >
                    <Download className="mr-2 h-4 w-4" /> Download
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

// Demo data for fallback when Supabase connection fails
const demoFiles: StudyFile[] = [
  {
    id: "1",
    name: "Math Formulas.pdf",
    url: "#",
    type: "application/pdf",
    size: 2500000, // 2.5MB
    uploadedBy: "John Doe",
    uploadedAt: "2023-05-15T10:30:00Z",
  },
  {
    id: "2",
    name: "Science Notes.docx",
    url: "#",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 1800000, // 1.8MB
    uploadedBy: "Jane Smith",
    uploadedAt: "2023-05-10T14:20:00Z",
  },
  {
    id: "3",
    name: "History Timeline.png",
    url: "#",
    type: "image/png",
    size: 3500000, // 3.5MB
    uploadedBy: "Admin",
    uploadedAt: "2023-05-05T09:15:00Z",
  },
];
