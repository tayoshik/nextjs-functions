const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

// Blob Storage の接続文字列
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
app.http('savePostFallback', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            context.log(`[DEBUG] Request method: ${request.method}`);

            // リクエストボディを JSON として解析
            const body = await request.json();
            context.log(`[DEBUG] Request body [Fallback]:`, body);

            const { threadId, post } = body;

            // バリデーション: 必須項目の確認
            if (!threadId || !post || !post.id || !post.name || !post.content) {
                context.log.error(`[ERROR] Invalid request body [Fallback]:`, body);
                return {
                    status: 400,
                    jsonBody: {
                        message: 'Invalid Request',
                        details: 'threadId and a valid post object are required.',
                    },
                };
            }

            // Blobサービスクライアントの作成
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const containerClient = blobServiceClient.getContainerClient('threads-backup');  // バックアップ用のコンテナに変更

            // Blobを取得
            const blobClient = containerClient.getBlockBlobClient(`${threadId}_backup.json`);  // バックアップ用のファイル名
            const exists = await blobClient.exists();

            let thread;

            if (exists) {
                // Blobが存在する場合、その内容を取得して解析
                const downloadResponse = await blobClient.download();
                const threadData = await streamToString(downloadResponse.readableStreamBody);
                thread = JSON.parse(threadData);
            } else {
                // Blobが存在しない場合、新しいスレッドを作成
                thread = {
                    id: threadId,
                    posts: [],
                    isBackup: true,  // バックアップフラグを追加
                    createdAt: new Date().toISOString()
                };
            }

            // 投稿に追加情報を付与
            const enhancedPost = {
                ...post,
                savedToBackup: true,
                backupTimestamp: new Date().toISOString()
            };

            // 新しい投稿を追加
            thread.posts.push(enhancedPost);

            // 更新されたデータをBlobに保存
            const updatedData = JSON.stringify(thread, null, 2);
            await blobClient.upload(Buffer.from(updatedData), updatedData.length, {
                blobHTTPHeaders: {
                    blobContentType: 'application/json',
                    blobContentEncoding: 'utf-8'
                },
                metadata: {
                    isBackup: 'true',
                    lastUpdated: new Date().toISOString()
                }
            });

            context.log(`[DEBUG] Post saved to backup thread ${threadId}:`, enhancedPost);
            return {
                status: 200,
                jsonBody: {
                    message: 'Post Saved to Backup',
                    threadId,
                    post: enhancedPost,
                    backupInfo: {
                        containerName: 'threads-backup',
                        blobName: `${threadId}_backup.json`,
                        timestamp: new Date().toISOString()
                    }
                },
            };
        } catch (error) {
            context.log.error(`[ERROR] Failed to process backup request:`, error);
            return {
                status: 500,
                jsonBody: {
                    message: 'Internal Server Error in Backup System',
                    error: error.message,
                },
            };
        }
    },
});

// StreamをStringに変換するユーティリティ関数
async function streamToString(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on('data', (data) => {
            chunks.push(Buffer.from(data));
        });
        readableStream.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
        readableStream.on('error', reject);
    });
}