import subprocess
import requests
import json
import os
import sys

# 1. Get token from git credential manager
p = subprocess.Popen(['git', 'credential', 'fill'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
stdout, _ = p.communicate(input='protocol=https\nhost=github.com\npath=HyyAnk/my-1x-project.git\n\n')
token = None
for line in stdout.splitlines():
    if line.startswith('password='):
        token = line.split('password=', 1)[1].strip()

if not token:
    print('Error: Could not retrieve GitHub token from Git credential manager.')
    sys.exit(1)

headers = {
    'Authorization': f'Bearer {token}',
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
}

repo = 'HyyAnk/my-1x-project'
tag_name = 'v1.0.0-assets'
release_name = 'Kid BGM Audio Pack v1.0.0'
release_body = '53 kid-friendly background music tracks with 100/120 BPM metadata for Quiz Engine.'

# 2. Check if release already exists
print(f'Checking release {tag_name} on {repo}...')
r = requests.get(f'https://api.github.com/repos/{repo}/releases/tags/{tag_name}', headers=headers)
if r.status_code == 200:
    print(f'Release {tag_name} already exists!')
    release_data = r.json()
else:
    print(f'Creating release {tag_name} on {repo}...')
    create_payload = {
        'tag_name': tag_name,
        'name': release_name,
        'body': release_body,
        'draft': False,
        'prerelease': False
    }
    r = requests.post(f'https://api.github.com/repos/{repo}/releases', headers=headers, json=create_payload)
    if r.status_code not in (200, 201):
        print(f'Failed to create release: {r.status_code} - {r.text}')
        sys.exit(1)
    release_data = r.json()
    print('Successfully created release: ' + release_data.get('html_url', ''))

release_id = release_data['id']
upload_url_template = release_data['upload_url'].split('{?')[0]

# 3. Upload asset
zip_path = os.path.abspath(r'dist-assets/kid-bgm-v1.0.0.zip')
if not os.path.exists(zip_path):
    print(f'Error: Zip file does not exist: {zip_path}')
    sys.exit(1)

zip_name = os.path.basename(zip_path)
zip_size = os.path.getsize(zip_path)
print(f'Uploading {zip_name} ({round(zip_size / (1024*1024), 2)} MB)...')

# Check if asset with same name exists and delete it first if so
for asset in release_data.get('assets', []):
    if asset['name'] == zip_name:
        print(f'Deleting existing asset {asset["id"]}...')
        requests.delete(asset['url'], headers=headers)

upload_headers = {
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/zip',
    'X-GitHub-Api-Version': '2022-11-28'
}

with open(zip_path, 'rb') as f:
    upload_res = requests.post(f'{upload_url_template}?name={zip_name}', headers=upload_headers, data=f)

if upload_res.status_code in (200, 201):
    asset_data = upload_res.json()
    print('======================================================')
    print('SUCCESS: GitHub Release Published and Asset Uploaded!')
    print('Asset Download URL: ' + asset_data.get('browser_download_url', ''))
    print('Release Page: ' + release_data.get('html_url', ''))
    print('======================================================')
else:
    print(f'Upload failed: {upload_res.status_code} - {upload_res.text}')
    sys.exit(1)
