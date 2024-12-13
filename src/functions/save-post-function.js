const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

// Blob Storage の接続文字列
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

app.http('savePost', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            context.log('[DEBUG] Starting savePost function');

            // 接続文字列の確認
            if (!connectionString) {
                context.log.error('[ERROR] Storage connection string not configured');
                return {
                    status: 500,
                    jsonBody: {
                        error: 'Storage configuration is missing',
                        timestamp: new Date().toISOString()
                    }
                };
            }

            // リクエストボディを JSON として解析
            const body = await request.json();
            context.log('[DEBUG] Request body:', body);

            const { id, threadId, name, content, timestamp } = body;

            // バリデーション: 必須項目の確認
            const missingFields = [];
            if (!id) missingFields.push('id');
            if (!threadId) missingFields.push('threadId');
            if (!name) missingFields.push('name');
            if (!content) missingFields.push('content');
            if (!timestamp) missingFields.push('timestamp');

            if (missingFields.length > 0) {
                context.log.error('[ERROR] Missing required fields:', missingFields);
                return {
                    status: 400,
                    jsonBody: {
                        error: 'Missing required fields',
                        details: missingFields.join(', '),
                        timestamp: new Date().toISOString()
                    }
                };
            }

            try {
                // Blobサービスクライアントの作成
                context.log('[DEBUG] Initializing Blob service client');
                const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
                const containerClient = blobServiceClient.getContainerClient('threads');

                // コンテナの存在確認
                const containerExists = await containerClient.exists();
                context.log('[DEBUG] Container exists:', containerExists);

                if (!containerExists) {
                    context.log.error('[ERROR] Container "threads" does not exist');
                    return {
                        status: 500,
                        jsonBody: {
                            error: 'Storage container not found',
                            timestamp: new Date().toISOString()
                        }
                    };
                }

                // スレッドの Blob を取得
                const blobName = `${threadId}.json`;
                const blobClient = containerClient.getBlockBlobClient(blobName);

                context.log('[DEBUG] Checking thread existence');
                const exists = await blobClient.exists();
                context.log('[DEBUG] Thread exists:', exists);

                let thread;
                if (exists) {
                    // 既存のスレッドデータを取得
                    context.log('[DEBUG] Retrieving existing thread');
                    const downloadResponse = await blobClient.download();
                    const threadData = await streamToString(downloadResponse.readableStreamBody);
                    thread = JSON.parse(threadData);
                } else {
                    // 新しいスレッドを作成
                    context.log('[DEBUG] Creating new thread');
                    thread = {
                        id: threadId,
                        posts: []
                    };
                }

                // 新しい投稿オブジェクトを作成
                const newPost = {
                    id,
                    name,
                    content,
                    timestamp
                };

                // 投稿を追加
                thread.posts = thread.posts || [];
                thread.posts.push(newPost);

                // 更新されたデータを保存
                const updatedData = JSON.stringify(thread, null, 2);
                context.log('[DEBUG] Saving updated thread data');

                await blobClient.upload(Buffer.from(updatedData), updatedData.length, {
                    blobHTTPHeaders: { blobContentType: 'application/json' }
                });

                context.log('[INFO] Post saved successfully:', { threadId, postId: id });
                return {
                    status: 201,
                    jsonBody: {
                        message: exists ? 'Post added to existing thread' : 'Post added to new thread',
                        threadId,
                        post: newPost,
                        timestamp: new Date().toISOString()
                    }
                };

            } catch (blobError) {
                context.log.error('[ERROR] Blob operation failed:', {
                    error: blobError.message,
                    code: blobError.code,
                    stack: blobError.stack
                });
                throw blobError;
            }

        } catch (error) {
            context.log.error('[ERROR] Function failed:', {
                name: error.name,
                message: error.message,
                code: error.code,
                stack: error.stack
            });

            return {
                status: 500,
                jsonBody: {
                    error: 'Internal Server Error',
                    details: error.message,
                    code: error.code || 'UNKNOWN_ERROR',
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
});

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