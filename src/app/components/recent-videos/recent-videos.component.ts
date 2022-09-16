import { Component, EventEmitter, Input, OnInit, Output, ViewChild } from '@angular/core';
import { PostsService } from 'app/posts.services';
import { Router } from '@angular/router';
import { DatabaseFile, FileType, FileTypeFilter } from '../../../api-types';
import { MatPaginator } from '@angular/material/paginator';
import { Subject } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';

@Component({
  selector: 'app-recent-videos',
  templateUrl: './recent-videos.component.html',
  styleUrls: ['./recent-videos.component.scss']
})
export class RecentVideosComponent implements OnInit {

  @Input() usePaginator = true;

  // File selection

  @Input() selectMode = false;
  @Input() defaultSelected: DatabaseFile[] = [];
  @Input() sub_id = null;
  @Input() customHeader = null;
  @Input() selectedIndex = 1;
  @Output() fileSelectionEmitter = new EventEmitter<{new_selection: string[], thumbnailURL: string}>();

  pageSize = 10;
  paged_data: DatabaseFile[] = null;

  selected_data: string[] = [];
  selected_data_objs: DatabaseFile[] = [];
  reverse_order = false;

  // File listing (with cards)

  cached_file_count = 0;
  loading_files = null;

  normal_files_received = false;
  subscription_files_received = false;
  file_count = 10;
  searchChangedSubject: Subject<string> = new Subject<string>();
  downloading_content = {};
  search_mode = false;
  search_text = '';
  searchIsFocused = false;
  descendingMode = true;
  filterProperties = {
    'registered': {
      'key': 'registered',
      'label': 'Download Date',
      'property': 'registered'
    },
    'upload_date': {
      'key': 'upload_date',
      'label': 'Upload Date',
      'property': 'upload_date'
    },
    'name': {
      'key': 'name',
      'label': 'Name',
      'property': 'title'
    },
    'file_size': {
      'key': 'file_size',
      'label': 'File Size',
      'property': 'size'
    },
    'duration': {
      'key': 'duration',
      'label': 'Duration',
      'property': 'duration'
    }
  };
  filterProperty = this.filterProperties['registered'];
  fileTypeFilter = 'both';
  
  playlists = null;

  @ViewChild('paginator') paginator: MatPaginator

  constructor(public postsService: PostsService, private router: Router) {
    // get cached file count
    if (localStorage.getItem('cached_file_count')) {
      this.cached_file_count = +localStorage.getItem('cached_file_count') <= 10 ? +localStorage.getItem('cached_file_count') : 10;
      this.loading_files = Array(this.cached_file_count).fill(0);
    }

    // set filter property to cached value
    const cached_filter_property = localStorage.getItem('filter_property');
    if (cached_filter_property && this.filterProperties[cached_filter_property]) {
      this.filterProperty = this.filterProperties[cached_filter_property];
    }

    // set file type filter to cached value
    const cached_file_type_filter = localStorage.getItem('file_type_filter');
    if (this.usePaginator && cached_file_type_filter) {
      this.fileTypeFilter = cached_file_type_filter;
    }

    const sort_order = localStorage.getItem('recent_videos_sort_order');

    if (sort_order) {
      this.descendingMode = sort_order === 'descending';
    }
  }

  ngOnInit(): void {
    if (this.postsService.initialized) {
      this.getAllFiles();
      this.getAllPlaylists();
    }

    this.postsService.service_initialized.subscribe(init => {
      if (init) {
        this.getAllFiles();
        this.getAllPlaylists();
      }
    });

    this.postsService.files_changed.subscribe(changed => {
      if (changed) {
        this.getAllFiles();
      }
    });

    this.postsService.playlists_changed.subscribe(changed => {
      if (changed) {
        this.getAllPlaylists();
      }
    });

    
    this.selected_data = this.defaultSelected.map(file => file.uid);
    this.selected_data_objs = this.defaultSelected;    

    this.searchChangedSubject
      .debounceTime(500)
      .pipe(distinctUntilChanged()
      ).subscribe(model => {
        if (model.length > 0) {
          this.search_mode = true;
        } else {
          this.search_mode = false;
        }
        this.getAllFiles();
      });
  }

  getAllPlaylists(): void {
    this.postsService.getPlaylists().subscribe(res => {
      this.playlists = res['playlists'];
    });
  }

  // search

  onSearchInputChanged(newvalue: string): void {
    this.normal_files_received = false;
    this.searchChangedSubject.next(newvalue);
  }

  filterOptionChanged(value: string): void {
    localStorage.setItem('filter_property', value['key']);
    this.getAllFiles();
  }

  fileTypeFilterChanged(value: string): void {
    localStorage.setItem('file_type_filter', value);
    this.getAllFiles();
  }

  toggleModeChange(): void {
    this.descendingMode = !this.descendingMode;
    localStorage.setItem('recent_videos_sort_order', this.descendingMode ? 'descending' : 'ascending');
    this.getAllFiles();
  }

  // get files

  getAllFiles(cache_mode = false): void {
    this.normal_files_received = cache_mode;
    const current_file_index = (this.paginator?.pageIndex ? this.paginator.pageIndex : 0)*this.pageSize;
    const sort = {by: this.filterProperty['property'], order: this.descendingMode ? -1 : 1};
    const range = [current_file_index, current_file_index + this.pageSize];
    this.postsService.getAllFiles(sort, range, this.search_mode ? this.search_text : null, this.fileTypeFilter as FileTypeFilter, this.sub_id).subscribe(res => {
      this.file_count = res['file_count'];
      this.paged_data = res['files'];
      for (let i = 0; i < this.paged_data.length; i++) {
        const file = this.paged_data[i];
        file.duration = typeof file.duration !== 'string' ? file.duration : this.durationStringToNumber(file.duration);
      }

      // set cached file count for future use, note that we convert the amount of files to a string
      localStorage.setItem('cached_file_count', '' + this.file_count);

      this.normal_files_received = true;

    });
  }

  // navigation

  goToFile(info_obj) {
    const file = info_obj['file'];
    const event = info_obj['event'];
    if (this.postsService.config['Extra']['download_only_mode']) {
      this.downloadFile(file);
    } else {
      this.navigateToFile(file, event.ctrlKey);
    }
  }

  navigateToFile(file: DatabaseFile, new_tab: boolean): void {
    localStorage.setItem('player_navigator', this.router.url);
    if (file.sub_id) {
        !new_tab ? this.router.navigate(['/player', {uid: file.uid,
                                        type: file.isAudio ? 'audio' : 'video'}]) 
                 : window.open(`/#/player;uid=${file.uid};type=${file.isAudio ? 'audio' : 'video'}`);
    } else {
      // normal files
      !new_tab ? this.router.navigate(['/player', {type: file.isAudio ? 'audio' : 'video', uid: file.uid}])
               : window.open(`/#/player;type=${file.isAudio ? 'audio' : 'video'};uid=${file.uid}`);
    }
  }

  goToSubscription(file: DatabaseFile): void {
    this.router.navigate(['/subscription', {id: file.sub_id}]);
  }

  // downloading

  downloadFile(file: DatabaseFile): void {
    const type = (file.isAudio ? 'audio' : 'video') as FileType;
    const ext = type === 'audio' ? '.mp3' : '.mp4'
    const name = file.id;
    this.downloading_content[file.uid] = true;
    this.postsService.downloadFileFromServer(file.uid).subscribe(res => {
      this.downloading_content[file.uid] = false;
      const blob: Blob = res;
      saveAs(blob, decodeURIComponent(name) + ext);

      if (!this.postsService.config.Extra.file_manager_enabled && !file.sub_id) {
        // tell server to delete the file once downloaded
        this.postsService.deleteFile(file.uid).subscribe(() => {
          // reload files
          this.getAllFiles();
        });
      }
    });
  }

  // deleting

  deleteFile(args) {
    const file = args.file;
    const blacklistMode = args.blacklistMode;

    if (file.sub_id) {
      this.deleteSubscriptionFile(file, blacklistMode);
    } else {
      this.deleteNormalFile(file, blacklistMode);
    }
  }

  deleteNormalFile(file: DatabaseFile, blacklistMode = false): void {
    this.postsService.deleteFile(file.uid, blacklistMode).subscribe(result => {
      if (result) {
        this.postsService.openSnackBar($localize`Delete success!`, $localize`OK.`);
        this.removeFileCard(file);
      } else {
        this.postsService.openSnackBar($localize`Delete failed!`, $localize`OK.`);
      }
    }, () => {
      this.postsService.openSnackBar($localize`Delete failed!`, $localize`OK.`);
    });
  }

  deleteSubscriptionFile(file: DatabaseFile, blacklistMode = false): void {
    if (blacklistMode) {
      this.deleteForever(file);
    } else {
      this.deleteAndRedownload(file);
    }
  }

  deleteAndRedownload(file: DatabaseFile): void {
    const sub = this.postsService.getSubscriptionByID(file.sub_id);
    this.postsService.deleteSubscriptionFile(sub, file.id, false, file.uid).subscribe(() => {
      this.postsService.openSnackBar($localize`Successfully deleted file: ` + file.id);
      this.removeFileCard(file);
    });
  }

  deleteForever(file: DatabaseFile): void {
    const sub = this.postsService.getSubscriptionByID(file.sub_id);
    this.postsService.deleteSubscriptionFile(sub, file.id, true, file.uid).subscribe(() => {
      this.postsService.openSnackBar($localize`Successfully deleted file: ` + file.id);
      this.removeFileCard(file);
    });
  }

  removeFileCard(file_to_remove: DatabaseFile): void {
    const index = this.paged_data.map(e => e.uid).indexOf(file_to_remove.uid);
    this.paged_data.splice(index, 1);
    this.getAllFiles(true);
  }

  // TODO: Add translation support for these snackbars
  addFileToPlaylist(info_obj) {
    const file = info_obj['file'];
    const playlist_id = info_obj['playlist_id'];
    const playlist = this.playlists.find(potential_playlist => potential_playlist['id'] === playlist_id);
    this.postsService.addFileToPlaylist(playlist_id, file['uid']).subscribe(res => {
      if (res['success']) {
        this.postsService.openSnackBar(`Successfully added ${file.title} to ${playlist.title}!`);
        this.postsService.playlists_changed.next(true);
      } else {
        this.postsService.openSnackBar(`Failed to add ${file.title} to ${playlist.title}! Unknown error.`);
      }
    }, err => {
      console.error(err);
      this.postsService.openSnackBar(`Failed to add ${file.title} to ${playlist.title}! See browser console for error.`);
    });
  }

  // sorting and filtering

  sortFiles(a: DatabaseFile, b: DatabaseFile): number {
    // uses the 'registered' flag as the timestamp
    const result = b.registered - a.registered;
    return result;
  }

  durationStringToNumber(dur_str: string): number {
    let num_sum = 0;
    const dur_str_parts = dur_str.split(':');
    for (let i = dur_str_parts.length - 1; i >= 0; i--) {
      num_sum += parseInt(dur_str_parts[i]) * (60 ** (dur_str_parts.length - 1 - i));
    }
    return num_sum;
  }

  pageChangeEvent(event) {
    this.pageSize = event.pageSize;
    this.loading_files = Array(this.pageSize).fill(0);
    this.getAllFiles();
  }

  fileSelectionChanged(event: { option: { _selected: boolean; value: DatabaseFile; } }): void {
    const adding = event.option._selected;
    const value = event.option.value;
    if (adding) {
      this.selected_data.push(value.uid);
      this.selected_data_objs.push(value);
    } else {
      this.selected_data      = this.selected_data.filter(e => e !== value.uid);
      this.selected_data_objs = this.selected_data_objs.filter(e => e.uid !== value.uid);
    }

    this.fileSelectionEmitter.emit({new_selection: this.selected_data, thumbnailURL: this.selected_data_objs[0].thumbnailURL});
  }

  toggleSelectionOrder(): void {
    this.reverse_order = !this.reverse_order;
    localStorage.setItem('default_playlist_order_reversed', '' + this.reverse_order);
  }

  drop(event: CdkDragDrop<string[]>): void {
    if (this.reverse_order) {
      event.previousIndex = this.selected_data.length - 1 - event.previousIndex;
      event.currentIndex = this.selected_data.length - 1 - event.currentIndex;
    }
    moveItemInArray(this.selected_data, event.previousIndex, event.currentIndex);
    moveItemInArray(this.selected_data_objs, event.previousIndex, event.currentIndex);
    this.fileSelectionEmitter.emit({new_selection: this.selected_data, thumbnailURL: this.selected_data_objs[0].thumbnailURL});
  }

  removeSelectedFile(index: number): void {
    if (this.reverse_order) {
      index = this.selected_data.length - 1 - index;
    }
    this.selected_data.splice(index, 1);
    this.selected_data_objs.splice(index, 1);
    this.fileSelectionEmitter.emit({new_selection: this.selected_data, thumbnailURL: this.selected_data_objs[0].thumbnailURL});
  }
}
